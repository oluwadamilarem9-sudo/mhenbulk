"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { evaluateLiveTrashProtection } from "@/features/gmail-cleaner/cleanup-guard";
import {
  classifyGmailMessage,
  type GmailCleanerCategory,
} from "@/features/gmail-cleaner/classify";
import { resolveGmailMailboxAccess } from "@/features/gmail-cleaner/gmail-access";
import { sanitizeEmailPreview } from "@/features/gmail-cleaner/sanitize-preview";
import {
  hasHardBlockedGmailLabel,
  isDefaultCleanupCandidateFromClassification,
  isManuallySelectable,
} from "@/features/gmail-cleaner/selection";
import {
  GmailApiError,
  getGmailMessageMetadata,
  getGmailMessageMetadataBatch,
  listGmailMessageIds,
  parseFromHeader,
  trashGmailMessage,
  untrashGmailMessage,
} from "@/lib/google/gmail-mailbox";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const SCAN_PAGE_SIZE = 40;
const METADATA_CONCURRENCY = 4;
const TRASH_CONCURRENCY = 3;
const STALE_SCAN_MS = 30 * 60 * 1000;

export type GmailCleanerActionState = {
  error?: string;
  code?: string;
  success?: string;
  scanId?: string;
  done?: boolean;
  processed?: number;
  totalEstimate?: number | null;
  clutterCount?: number;
  protectedCount?: number;
  needsReviewCount?: number;
  operationId?: string;
  successCount?: number;
  failedCount?: number;
  skippedCount?: number;
  preview?: string;
};

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function trustedClient(
  fallback: Awaited<ReturnType<typeof createClient>>,
) {
  try {
    return createServiceRoleClient();
  } catch {
    return fallback as unknown as ReturnType<typeof createServiceRoleClient>;
  }
}

function emptyCategoryCounts(): Record<GmailCleanerCategory, number> {
  return {
    promotions: 0,
    newsletters: 0,
    marketing: 0,
    notifications: 0,
    social_updates: 0,
    old_conversations: 0,
    spam_like: 0,
    large_attachments: 0,
    needs_review: 0,
    protected: 0,
  };
}

function asCategoryCounts(
  value: unknown,
): Record<GmailCleanerCategory, number> {
  const base = emptyCategoryCounts();
  if (!value || typeof value !== "object") return base;
  for (const key of Object.keys(base) as GmailCleanerCategory[]) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      base[key] = raw;
    }
  }
  return base;
}

export async function startGmailScanAction(
  emailAccountId: string,
): Promise<GmailCleanerActionState> {
  const idResult = uuid.safeParse(emailAccountId);
  if (!idResult.success) return { error: "Select a Gmail account." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const trusted = trustedClient(supabase);
  const access = await resolveGmailMailboxAccess(
    trusted,
    user.id,
    idResult.data,
  );
  if (!access.ok) {
    return { error: access.error, code: access.code };
  }

  const { data: active } = await supabase
    .from("gmail_cleaner_scans")
    .select("id, status, updated_at")
    .eq("user_id", user.id)
    .eq("email_account_id", idResult.data)
    .in("status", ["pending", "running"])
    .maybeSingle();

  if (active) {
    const updatedAt = active.updated_at
      ? new Date(active.updated_at).getTime()
      : 0;
    const stale =
      !Number.isFinite(updatedAt) || Date.now() - updatedAt > STALE_SCAN_MS;
    if (!stale) {
      return {
        success: "A scan is already in progress for this account.",
        scanId: active.id,
        done: false,
      };
    }
    // Recover abandoned client-pump scans so a new scan can start.
    await supabase
      .from("gmail_cleaner_scans")
      .update({
        status: "failed",
        error_message: "Previous scan timed out and was recovered.",
        completed_at: new Date().toISOString(),
        cancel_requested: true,
      })
      .eq("id", active.id)
      .eq("user_id", user.id)
      .in("status", ["pending", "running"]);
  }

  const { data: scan, error } = await supabase
    .from("gmail_cleaner_scans")
    .insert({
      user_id: user.id,
      email_account_id: idResult.data,
      status: "running",
      started_at: new Date().toISOString(),
      category_counts: emptyCategoryCounts(),
    })
    .select("id")
    .single();

  if (error || !scan) {
    return {
      error: error?.message?.includes("gmail_cleaner_scans_one_active")
        ? "A scan is already running for this account."
        : "Unable to start the Gmail scan.",
    };
  }

  revalidatePath("/gmail-cleaner");
  return {
    success: "Scan started.",
    scanId: scan.id,
    done: false,
  };
}

export async function processGmailScanChunkAction(
  scanId: string,
): Promise<GmailCleanerActionState> {
  const idResult = uuid.safeParse(scanId);
  if (!idResult.success) return { error: "Invalid scan." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const trusted = trustedClient(supabase);
  const { data: scan } = await supabase
    .from("gmail_cleaner_scans")
    .select("*")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!scan) return { error: "Scan not found." };
  if (scan.status === "cancelled") {
    return { success: "Scan cancelled.", scanId: scan.id, done: true };
  }
  if (scan.status === "completed" || scan.status === "partial") {
    return {
      success: "Scan already finished.",
      scanId: scan.id,
      done: true,
      processed: scan.messages_processed,
    };
  }
  if (scan.cancel_requested) {
    await supabase
      .from("gmail_cleaner_scans")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", scan.id)
      .eq("user_id", user.id);
    return { success: "Scan cancelled.", scanId: scan.id, done: true };
  }

  const access = await resolveGmailMailboxAccess(
    trusted,
    user.id,
    scan.email_account_id,
  );
  if (!access.ok) {
    await supabase
      .from("gmail_cleaner_scans")
      .update({
        status: "failed",
        error_message: access.error,
        completed_at: new Date().toISOString(),
      })
      .eq("id", scan.id)
      .eq("user_id", user.id);
    return { error: access.error, code: access.code, scanId: scan.id, done: true };
  }

  try {
    const page = await listGmailMessageIds(access.accessToken, {
      pageToken: scan.page_token,
      pageSize: SCAN_PAGE_SIZE,
      includeSpamTrash: true,
    });

    const { messages, failures } = await getGmailMessageMetadataBatch(
      access.accessToken,
      page.messageIds,
      METADATA_CONCURRENCY,
    );

    const categoryCounts = asCategoryCounts(scan.category_counts);
    let clutterDelta = 0;
    let protectedDelta = 0;
    let needsReviewDelta = 0;
    let spamDelta = 0;
    let trashDelta = 0;
    let draftDelta = 0;
    let sentDelta = 0;

    const rows = messages.map((message) => {
      const classified = classifyGmailMessage(message);
      const from = parseFromHeader(message.headers.from);
      const labels = message.labelIds ?? [];
      const isSpam = labels.includes("SPAM");
      const isTrash = labels.includes("TRASH");
      const isDraft = labels.includes("DRAFT");
      const isSent = labels.includes("SENT");

      const defaultSelected = isDefaultCleanupCandidateFromClassification(
        classified,
        { isSpam, isTrash, isDraft, isSent, labelIds: labels },
      );

      categoryCounts[classified.primaryCategory] += 1;
      if (classified.protectionStatus === "protected") protectedDelta += 1;
      // Potential clutter = default cleanup candidates only (never review/keep).
      if (defaultSelected) clutterDelta += 1;
      // Needs review = uncertain suggestions, not merely the needs_review category label.
      if (
        classified.suggestedAction === "review" &&
        classified.protectionStatus !== "protected"
      ) {
        needsReviewDelta += 1;
      }
      if (isSpam) spamDelta += 1;
      if (isTrash) trashDelta += 1;
      if (isDraft) draftDelta += 1;
      if (isSent) sentDelta += 1;

      const internalMs = message.internalDate
        ? Number(message.internalDate)
        : NaN;
      const messageDate = Number.isFinite(internalMs)
        ? new Date(internalMs).toISOString()
        : message.headers.date
          ? new Date(message.headers.date).toISOString()
          : null;

      return {
        user_id: user.id,
        scan_id: scan.id,
        email_account_id: scan.email_account_id,
        gmail_message_id: message.id,
        gmail_thread_id: message.threadId,
        sender_name: from.name,
        sender_email: from.email,
        subject: message.headers.subject
          ? message.headers.subject.slice(0, 500)
          : null,
        message_date:
          messageDate && !Number.isNaN(Date.parse(messageDate))
            ? messageDate
            : null,
        label_ids: labels,
        size_estimate: message.sizeEstimate,
        primary_category: classified.primaryCategory,
        classification_reason: classified.reason.slice(0, 500),
        confidence: classified.confidence,
        protection_status: classified.protectionStatus,
        suggested_action: classified.suggestedAction,
        selected: defaultSelected,
        is_spam: isSpam,
        is_trash: isTrash,
        is_draft: isDraft,
        is_sent: isSent,
      };
    });

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from("gmail_cleaner_messages")
        .upsert(rows, { onConflict: "scan_id,gmail_message_id" });
      if (upsertError) {
        throw new Error(upsertError.message);
      }
    }

    const processed =
      scan.messages_processed + page.messageIds.length;
    const done = !page.nextPageToken;
    const partialFailures = failures.length > 0;

    // Compare-and-swap prevents concurrent chunk pumps from double-counting
    // the same page, and refuses to overwrite a cancelled scan.
    const { data: advanced } = await supabase
      .from("gmail_cleaner_scans")
      .update({
        page_token: page.nextPageToken,
        messages_processed: processed,
        total_estimate: page.resultSizeEstimate ?? scan.total_estimate,
        clutter_count: scan.clutter_count + clutterDelta,
        protected_count: scan.protected_count + protectedDelta,
        needs_review_count: scan.needs_review_count + needsReviewDelta,
        spam_count: scan.spam_count + spamDelta,
        trash_count: scan.trash_count + trashDelta,
        draft_count: scan.draft_count + draftDelta,
        sent_count: scan.sent_count + sentDelta,
        category_counts: categoryCounts,
        status: done
          ? partialFailures
            ? "partial"
            : "completed"
          : "running",
        completed_at: done ? new Date().toISOString() : null,
        error_message: partialFailures
          ? `${failures.length} message(s) could not be loaded in the last page.`
          : scan.error_message,
      })
      .eq("id", scan.id)
      .eq("user_id", user.id)
      .eq("status", "running")
      .eq("cancel_requested", false)
      .eq("messages_processed", scan.messages_processed)
      .select("id, status, messages_processed, clutter_count, protected_count, needs_review_count, total_estimate")
      .maybeSingle();

    if (!advanced) {
      const { data: latest } = await supabase
        .from("gmail_cleaner_scans")
        .select(
          "id, status, messages_processed, clutter_count, protected_count, needs_review_count, total_estimate",
        )
        .eq("id", scan.id)
        .eq("user_id", user.id)
        .maybeSingle();
      const finished =
        !latest ||
        latest.status === "cancelled" ||
        latest.status === "completed" ||
        latest.status === "partial" ||
        latest.status === "failed";
      revalidatePath("/gmail-cleaner");
      return {
        success:
          latest?.status === "cancelled"
            ? "Scan cancelled."
            : "Scan progress already advanced by another worker.",
        scanId: scan.id,
        done: finished,
        processed: latest?.messages_processed ?? scan.messages_processed,
        totalEstimate: latest?.total_estimate ?? scan.total_estimate,
        clutterCount: latest?.clutter_count ?? scan.clutter_count,
        protectedCount: latest?.protected_count ?? scan.protected_count,
        needsReviewCount: latest?.needs_review_count ?? scan.needs_review_count,
      };
    }

    if (done) {
      // Final pass: selection flags match default cleanup candidates only.
      await supabase
        .from("gmail_cleaner_messages")
        .update({ selected: false })
        .eq("user_id", user.id)
        .eq("scan_id", scan.id)
        .eq("selected", true)
        .neq("suggested_action", "trash");
      await supabase
        .from("gmail_cleaner_messages")
        .update({ selected: true })
        .eq("user_id", user.id)
        .eq("scan_id", scan.id)
        .eq("suggested_action", "trash")
        .eq("protection_status", "none")
        .eq("is_draft", false)
        .eq("is_sent", false)
        .eq("is_spam", false)
        .eq("is_trash", false);
    }

    revalidatePath("/gmail-cleaner");
    return {
      success: done ? "Scan completed." : "Scan progress saved.",
      scanId: scan.id,
      done,
      processed,
      totalEstimate: page.resultSizeEstimate ?? scan.total_estimate,
      clutterCount: scan.clutter_count + clutterDelta,
      protectedCount: scan.protected_count + protectedDelta,
      needsReviewCount: scan.needs_review_count + needsReviewDelta,
    };
  } catch (error) {
    const message =
      error instanceof GmailApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Scan failed.";
    const code =
      error instanceof GmailApiError ? error.code : "provider_error";

    await supabase
      .from("gmail_cleaner_scans")
      .update({
        status: scan.messages_processed > 0 ? "partial" : "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", scan.id)
      .eq("user_id", user.id)
      .eq("status", "running");

    revalidatePath("/gmail-cleaner");
    return {
      error: message,
      code,
      scanId: scan.id,
      done: true,
      processed: scan.messages_processed,
    };
  }
}

export async function cancelGmailScanAction(
  scanId: string,
): Promise<GmailCleanerActionState> {
  const idResult = uuid.safeParse(scanId);
  if (!idResult.success) return { error: "Invalid scan." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data, error } = await supabase
    .from("gmail_cleaner_scans")
    .update({
      cancel_requested: true,
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .in("status", ["pending", "running"])
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return { error: "Unable to cancel this scan." };
  }
  revalidatePath("/gmail-cleaner");
  return { success: "Scan cancelled.", scanId: data.id, done: true };
}

export async function setGmailCleanerSelectionAction(
  scanId: string,
  messageIds: string[],
  selected: boolean,
): Promise<GmailCleanerActionState> {
  const parsed = z
    .object({
      scanId: uuid,
      messageIds: z.array(z.string().min(1).max(200)).max(500),
      selected: z.boolean(),
    })
    .safeParse({ scanId, messageIds, selected });
  if (!parsed.success) return { error: "Invalid selection." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  // Manual toggles may include needs-review, but never blocked messages.
  let query = supabase
    .from("gmail_cleaner_messages")
    .update({ selected: parsed.data.selected })
    .eq("user_id", user.id)
    .eq("scan_id", parsed.data.scanId)
    .in("gmail_message_id", parsed.data.messageIds)
    .eq("protection_status", "none")
    .eq("is_draft", false)
    .eq("is_sent", false)
    .eq("is_spam", false)
    .eq("is_trash", false);

  if (parsed.data.selected) {
    // Selecting requires a cleanup-or-review suggestion; keep stays unselected.
    query = query.in("suggested_action", ["trash", "review"]);
  }

  const { error } = await query;

  if (error) return { error: "Unable to update selection." };
  revalidatePath("/gmail-cleaner");
  return { success: "Selection updated." };
}

export async function selectCategoryForCleanupAction(
  scanId: string,
  category: GmailCleanerCategory,
  selected: boolean,
): Promise<GmailCleanerActionState> {
  const parsed = z
    .object({
      scanId: uuid,
      category: z.enum([
        "promotions",
        "newsletters",
        "marketing",
        "notifications",
        "social_updates",
        "old_conversations",
        "spam_like",
        "large_attachments",
        "needs_review",
        "protected",
      ]),
      selected: z.boolean(),
    })
    .safeParse({ scanId, category, selected });
  if (!parsed.success) return { error: "Invalid category." };
  if (parsed.data.category === "protected") {
    return { error: "Protected messages cannot be selected for cleanup." };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  // Select: only default cleanup candidates (suggested trash).
  // Clear: any previously selected non-blocked rows in that category (including
  // needs-review left selected by older bulk-select behaviour).
  let query = supabase
    .from("gmail_cleaner_messages")
    .update({ selected: parsed.data.selected })
    .eq("user_id", user.id)
    .eq("scan_id", parsed.data.scanId)
    .eq("primary_category", parsed.data.category)
    .eq("protection_status", "none")
    .eq("is_draft", false)
    .eq("is_sent", false)
    .eq("is_spam", false)
    .eq("is_trash", false);

  if (parsed.data.selected) {
    query = query.eq("suggested_action", "trash");
  } else {
    query = query.in("suggested_action", ["trash", "review"]);
  }

  const { error } = await query;

  if (error) return { error: "Unable to update category selection." };
  revalidatePath("/gmail-cleaner");
  return { success: "Category selection updated." };
}

export async function previewGmailCleanerMessageAction(
  scanId: string,
  gmailMessageId: string,
): Promise<GmailCleanerActionState> {
  const parsed = z
    .object({
      scanId: uuid,
      gmailMessageId: z.string().min(1).max(200),
    })
    .safeParse({ scanId, gmailMessageId });
  if (!parsed.success) return { error: "Invalid message." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: row } = await supabase
    .from("gmail_cleaner_messages")
    .select("email_account_id, classification_reason, subject, sender_email")
    .eq("user_id", user.id)
    .eq("scan_id", parsed.data.scanId)
    .eq("gmail_message_id", parsed.data.gmailMessageId)
    .maybeSingle();

  if (!row) return { error: "Message not found in this scan." };

  // Safe preview from stored metadata only — no HTML body download.
  const preview = sanitizeEmailPreview(
    [
      row.subject ? `Subject: ${row.subject}` : null,
      row.sender_email ? `From: ${row.sender_email}` : null,
      row.classification_reason,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return { success: "Preview ready.", preview };
}

export async function trashSelectedGmailMessagesAction(
  scanId: string,
  confirmed: boolean,
): Promise<GmailCleanerActionState> {
  if (!confirmed) {
    return { error: "Confirm that selected emails should move to Gmail Trash." };
  }
  const idResult = uuid.safeParse(scanId);
  if (!idResult.success) return { error: "Invalid scan." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const trusted = trustedClient(supabase);
  const { data: scan } = await supabase
    .from("gmail_cleaner_scans")
    .select("id, email_account_id, status")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!scan) return { error: "Scan not found." };

  const access = await resolveGmailMailboxAccess(
    trusted,
    user.id,
    scan.email_account_id,
  );
  if (!access.ok) {
    return { error: access.error, code: access.code };
  }
  const accessToken = access.accessToken;
  const accountId = scan.email_account_id;

  // Drop blocked rows that were incorrectly left selected (stale UI / old bugs).
  await supabase
    .from("gmail_cleaner_messages")
    .update({ selected: false })
    .eq("user_id", user.id)
    .eq("scan_id", scan.id)
    .eq("selected", true)
    .or(
      "protection_status.eq.protected,is_draft.eq.true,is_sent.eq.true,is_spam.eq.true,is_trash.eq.true",
    );

  const { data: selected } = await supabase
    .from("gmail_cleaner_messages")
    .select("*")
    .eq("user_id", user.id)
    .eq("scan_id", scan.id)
    .eq("email_account_id", accountId)
    .eq("selected", true)
    .eq("protection_status", "none")
    .eq("is_draft", false)
    .eq("is_sent", false)
    .eq("is_spam", false)
    .eq("is_trash", false)
    .in("suggested_action", ["trash", "review"])
    .limit(2000);

  const candidates = (selected ?? []).filter((row) =>
    isManuallySelectable({
      protectionStatus: row.protection_status,
      isSpam: row.is_spam,
      isTrash: row.is_trash,
      isDraft: row.is_draft,
      isSent: row.is_sent,
      labelIds: row.label_ids,
    }) && !hasHardBlockedGmailLabel(row.label_ids),
  );
  if (candidates.length === 0) {
    return { error: "No eligible messages are selected for cleanup." };
  }

  const categorySummary: Record<string, number> = {};
  for (const row of candidates) {
    categorySummary[row.primary_category] =
      (categorySummary[row.primary_category] ?? 0) + 1;
  }

  const { data: operation, error: opError } = await supabase
    .from("gmail_cleaner_operations")
    .insert({
      user_id: user.id,
      email_account_id: accountId,
      scan_id: scan.id,
      status: "running",
      action: "trash",
      selected_count: candidates.length,
      category_summary: categorySummary,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (opError || !operation) {
    return { error: "Unable to start cleanup operation." };
  }

  const userId = user.id;
  const operationId = operation.id;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let next = 0;

  async function worker() {
    while (next < candidates.length) {
      const index = next++;
      const row = candidates[index];

      if (
        row.protection_status === "protected" ||
        row.is_draft ||
        row.is_sent ||
        row.is_spam ||
        row.is_trash ||
        hasHardBlockedGmailLabel(row.label_ids) ||
        row.email_account_id !== accountId
      ) {
        skippedCount += 1;
        await supabase.from("gmail_cleaner_operation_items").insert({
          user_id: userId,
          operation_id: operationId,
          email_account_id: accountId,
          gmail_message_id: row.gmail_message_id,
          gmail_thread_id: row.gmail_thread_id,
          subject: row.subject,
          sender_email: row.sender_email,
          primary_category: row.primary_category,
          status: "skipped",
          error_message: "Protected or already in Spam/Trash.",
          was_already_trash: row.is_trash,
        });
        continue;
      }

      try {
        // Fetch latest labels/metadata immediately before trash.
        let liveMetadata = null;
        let liveError: GmailApiError | null = null;
        try {
          liveMetadata = await getGmailMessageMetadata(
            accessToken,
            row.gmail_message_id,
          );
        } catch (error) {
          if (error instanceof GmailApiError) {
            if (
              error.code === "auth_required" ||
              error.code === "forbidden"
            ) {
              throw error;
            }
            liveError = error;
          } else {
            liveError = new GmailApiError(
              "Failed to load latest Gmail metadata.",
              "transient",
              0,
            );
          }
        }

        const guard = evaluateLiveTrashProtection(liveMetadata, liveError);
        if (!guard.ok) {
          skippedCount += 1;
          await supabase.from("gmail_cleaner_operation_items").insert({
            user_id: userId,
            operation_id: operationId,
            email_account_id: accountId,
            gmail_message_id: row.gmail_message_id,
            gmail_thread_id: row.gmail_thread_id,
            subject: row.subject,
            sender_email: row.sender_email,
            primary_category: row.primary_category,
            status: guard.status,
            error_message: guard.reason,
            was_already_trash: guard.wasAlreadyTrash,
          });
          if (liveMetadata) {
            const labels = liveMetadata.labelIds ?? [];
            const liveClassified = classifyGmailMessage(liveMetadata);
            await supabase
              .from("gmail_cleaner_messages")
              .update({
                selected: false,
                label_ids: labels,
                is_spam: labels.includes("SPAM"),
                is_trash: labels.includes("TRASH"),
                is_draft: labels.includes("DRAFT"),
                is_sent: labels.includes("SENT"),
                protection_status: liveClassified.protectionStatus,
                suggested_action: liveClassified.suggestedAction,
                primary_category: liveClassified.primaryCategory,
                classification_reason: liveClassified.reason.slice(0, 500),
              })
              .eq("id", row.id)
              .eq("user_id", userId);
          } else {
            await supabase
              .from("gmail_cleaner_messages")
              .update({ selected: false })
              .eq("id", row.id)
              .eq("user_id", userId);
          }
          continue;
        }

        await trashGmailMessage(accessToken, row.gmail_message_id);
        successCount += 1;
        await supabase.from("gmail_cleaner_operation_items").insert({
          user_id: userId,
          operation_id: operationId,
          email_account_id: accountId,
          gmail_message_id: row.gmail_message_id,
          gmail_thread_id: row.gmail_thread_id,
          subject: row.subject,
          sender_email: row.sender_email,
          primary_category: row.primary_category,
          status: "trashed",
          was_already_trash: false,
        });
        await supabase
          .from("gmail_cleaner_messages")
          .update({
            selected: false,
            is_trash: true,
            suggested_action: "keep",
          })
          .eq("id", row.id)
          .eq("user_id", userId);
      } catch (error) {
        failedCount += 1;
        const message =
          error instanceof GmailApiError
            ? error.message
            : "Failed to move message to Trash.";
        if (
          error instanceof GmailApiError &&
          (error.code === "auth_required" || error.code === "forbidden")
        ) {
          throw error;
        }
        await supabase.from("gmail_cleaner_operation_items").insert({
          user_id: userId,
          operation_id: operationId,
          email_account_id: accountId,
          gmail_message_id: row.gmail_message_id,
          gmail_thread_id: row.gmail_thread_id,
          subject: row.subject,
          sender_email: row.sender_email,
          primary_category: row.primary_category,
          status: "failed",
          error_message: message,
          was_already_trash: false,
        });
      }
    }
  }

  try {
    await Promise.all(
      Array.from(
        { length: Math.min(TRASH_CONCURRENCY, candidates.length) },
        () => worker(),
      ),
    );
  } catch (error) {
    const message =
      error instanceof GmailApiError
        ? error.message
        : "Cleanup stopped due to an authorization error.";
    await supabase
      .from("gmail_cleaner_operations")
      .update({
        status: successCount > 0 ? "partial" : "failed",
        success_count: successCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", operationId)
      .eq("user_id", userId);
    revalidatePath("/gmail-cleaner");
    return {
      error: message,
      code: error instanceof GmailApiError ? error.code : "auth_required",
      operationId,
      successCount,
      failedCount,
      skippedCount,
    };
  }

  const status =
    failedCount === 0
      ? "completed"
      : successCount > 0
        ? "partial"
        : "failed";

  await supabase
    .from("gmail_cleaner_operations")
    .update({
      status,
      success_count: successCount,
      failed_count: failedCount,
      skipped_count: skippedCount,
      completed_at: new Date().toISOString(),
    })
    .eq("id", operationId)
    .eq("user_id", userId);

  revalidatePath("/gmail-cleaner");
  return {
    success:
      failedCount === 0
        ? `Moved ${successCount} email${successCount === 1 ? "" : "s"} to Gmail Trash.`
        : `Moved ${successCount} to Trash; ${failedCount} failed; ${skippedCount} skipped.`,
    operationId,
    successCount,
    failedCount,
    skippedCount,
  };
}

export async function restoreGmailCleanerItemsAction(
  operationId: string,
  itemIds: string[],
): Promise<GmailCleanerActionState> {
  const parsed = z
    .object({
      operationId: uuid,
      itemIds: z.array(uuid).min(1).max(200),
    })
    .safeParse({ operationId, itemIds });
  if (!parsed.success) return { error: "Select messages to restore." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const trusted = trustedClient(supabase);
  const { data: operation } = await supabase
    .from("gmail_cleaner_operations")
    .select("id, email_account_id")
    .eq("id", parsed.data.operationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!operation) return { error: "Cleanup operation not found." };

  const access = await resolveGmailMailboxAccess(
    trusted,
    user.id,
    operation.email_account_id,
  );
  if (!access.ok) {
    return { error: access.error, code: access.code };
  }

  const { data: items } = await supabase
    .from("gmail_cleaner_operation_items")
    .select("*")
    .eq("user_id", user.id)
    .eq("operation_id", operation.id)
    .in("id", parsed.data.itemIds)
    .eq("status", "trashed")
    .is("restored_at", null)
    .eq("was_already_trash", false);

  const restorable = items ?? [];
  if (restorable.length === 0) {
    return {
      error:
        "No restorable messages found. Only messages Mhenbulk moved to Trash can be restored.",
    };
  }

  let successCount = 0;
  let failedCount = 0;

  for (const item of restorable) {
    try {
      await untrashGmailMessage(access.accessToken, item.gmail_message_id);
      successCount += 1;
      await supabase
        .from("gmail_cleaner_operation_items")
        .update({
          status: "restored",
          restored_at: new Date().toISOString(),
        })
        .eq("id", item.id)
        .eq("user_id", user.id);
    } catch (error) {
      failedCount += 1;
      await supabase
        .from("gmail_cleaner_operation_items")
        .update({
          error_message:
            error instanceof GmailApiError
              ? error.message
              : "Restore failed.",
        })
        .eq("id", item.id)
        .eq("user_id", user.id);
    }
  }

  revalidatePath("/gmail-cleaner");
  return {
    success:
      failedCount === 0
        ? `Restored ${successCount} message${successCount === 1 ? "" : "s"}.`
        : `Restored ${successCount}; ${failedCount} failed.`,
    successCount,
    failedCount,
  };
}
