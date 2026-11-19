import { hasGmailModifyScope } from "@/lib/google/scopes";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import type { GmailCleanerCategory } from "@/features/gmail-cleaner/classify";
import { CATEGORY_LABELS } from "@/features/gmail-cleaner/classify";
import {
  aggregateGmailCleanerStats,
  emptyCategoryStats,
  type StatsMessage,
} from "@/features/gmail-cleaner/stats";

type CleanerClient = Awaited<ReturnType<typeof createClient>>;

async function healScanSelections(
  supabase: CleanerClient,
  userId: string,
  scanId: string,
): Promise<void> {
  // Repair legacy Trash rows that were stored under needs_review.
  // Safe to ignore when migration 0023 has not been applied yet — live stats
  // still remap is_trash → already_trash via displayCategoryForStats.
  await supabase
    .from("gmail_cleaner_messages")
    .update({
      primary_category: "already_trash",
      suggested_action: "keep",
      selected: false,
    })
    .eq("user_id", userId)
    .eq("scan_id", scanId)
    .eq("is_trash", true)
    .eq("primary_category", "needs_review");

  // Heal rows that must never remain selected (blocked or keep-only).
  await supabase
    .from("gmail_cleaner_messages")
    .update({ selected: false })
    .eq("user_id", userId)
    .eq("scan_id", scanId)
    .eq("selected", true)
    .or(
      "protection_status.eq.protected,is_draft.eq.true,is_sent.eq.true,is_spam.eq.true,is_trash.eq.true,suggested_action.eq.keep",
    );

  const [{ count: clutterCount }, { count: selectedReviewCount }, { count: selectedTrashCount }] =
    await Promise.all([
      supabase
        .from("gmail_cleaner_messages")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("scan_id", scanId)
        .eq("suggested_action", "trash")
        .eq("protection_status", "none")
        .eq("is_draft", false)
        .eq("is_sent", false)
        .eq("is_spam", false)
        .eq("is_trash", false),
      supabase
        .from("gmail_cleaner_messages")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("scan_id", scanId)
        .eq("selected", true)
        .eq("suggested_action", "review"),
      supabase
        .from("gmail_cleaner_messages")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("scan_id", scanId)
        .eq("selected", true)
        .eq("suggested_action", "trash")
        .eq("protection_status", "none")
        .eq("is_draft", false)
        .eq("is_sent", false)
        .eq("is_spam", false)
        .eq("is_trash", false),
    ]);

  const clutter = clutterCount ?? 0;
  const reviewSelected = selectedReviewCount ?? 0;
  const trashSelected = selectedTrashCount ?? 0;

  // Older category "Select" marked needs-review as selected. If selected volume
  // exceeds actual clutter candidates, drop those review selections.
  if (reviewSelected > 0 && trashSelected + reviewSelected > clutter) {
    await supabase
      .from("gmail_cleaner_messages")
      .update({ selected: false })
      .eq("user_id", userId)
      .eq("scan_id", scanId)
      .eq("selected", true)
      .eq("suggested_action", "review");
  }
}

async function loadLiveScanAggregates(
  supabase: CleanerClient,
  userId: string,
  scanId: string,
): Promise<{
  clutterCount: number;
  protectedCount: number;
  needsReviewCount: number;
  spamCount: number;
  trashCount: number;
  selectedCount: number;
  categoryCounts: Record<GmailCleanerCategory, number>;
  messagesProcessedLive: number;
}> {
  const { data } = await supabase
    .from("gmail_cleaner_messages")
    .select(
      "protection_status, suggested_action, selected, is_spam, is_trash, is_draft, is_sent, label_ids, primary_category",
    )
    .eq("user_id", userId)
    .eq("scan_id", scanId);

  const messages: StatsMessage[] = (data ?? []).map((row) => ({
    protectionStatus: row.protection_status,
    suggestedAction: row.suggested_action,
    selected: row.selected,
    isSpam: row.is_spam,
    isTrash: row.is_trash,
    isDraft: row.is_draft,
    isSent: row.is_sent,
    labelIds: row.label_ids ?? [],
    primaryCategory: (row.primary_category in emptyCategoryStats()
      ? row.primary_category
      : "needs_review") as GmailCleanerCategory,
  }));

  const aggregated = aggregateGmailCleanerStats(messages);
  return {
    clutterCount: aggregated.cards.potentialClutter,
    protectedCount: aggregated.cards.protected,
    needsReviewCount: aggregated.cards.manualReview,
    spamCount: aggregated.cards.alreadyInSpam,
    trashCount: aggregated.cards.alreadyInTrash,
    selectedCount: aggregated.cards.selectedEligible,
    categoryCounts: aggregated.categories,
    messagesProcessedLive: aggregated.cards.scanned,
  };
}

export type GmailCleanerAccountOption = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  hasModifyScope: boolean;
};

export type GmailCleanerScanSummary = {
  id: string;
  emailAccountId: string;
  accountEmail: string;
  status: string;
  messagesProcessed: number;
  totalEstimate: number | null;
  clutterCount: number;
  protectedCount: number;
  needsReviewCount: number;
  spamCount: number;
  trashCount: number;
  draftCount: number;
  sentCount: number;
  selectedCount: number;
  categoryCounts: Record<GmailCleanerCategory, number>;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type GmailCleanerMessageRow = {
  id: string;
  gmailMessageId: string;
  gmailThreadId: string | null;
  senderName: string | null;
  senderEmail: string | null;
  subject: string | null;
  messageDate: string | null;
  labelIds: string[];
  sizeEstimate: number | null;
  primaryCategory: GmailCleanerCategory;
  categoryLabel: string;
  classificationReason: string;
  confidence: string;
  protectionStatus: string;
  suggestedAction: string;
  selected: boolean;
  isSpam: boolean;
  isTrash: boolean;
  isDraft: boolean;
  isSent: boolean;
};

export type GmailCleanerOperationSummary = {
  id: string;
  accountEmail: string;
  status: string;
  action: string;
  selectedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  categorySummary: Record<string, number>;
  createdAt: string;
  completedAt: string | null;
};

export type GmailCleanerOperationItem = {
  id: string;
  gmailMessageId: string;
  subject: string | null;
  senderEmail: string | null;
  primaryCategory: string | null;
  status: string;
  errorMessage: string | null;
  wasAlreadyTrash: boolean;
  restoredAt: string | null;
};

export async function listGmailCleanerAccounts(
  userId: string,
): Promise<GmailCleanerAccountOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("email_accounts")
    .select("id, email, display_name, status, scopes")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .neq("status", "disconnected")
    .order("created_at", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    hasModifyScope: hasGmailModifyScope(row.scopes),
  }));
}

export async function getLatestGmailCleanerScan(
  userId: string,
  emailAccountId?: string | null,
): Promise<GmailCleanerScanSummary | null> {
  const supabase = await createClient();
  let query = supabase
    .from("gmail_cleaner_scans")
    .select(
      "id, email_account_id, status, messages_processed, total_estimate, clutter_count, protected_count, needs_review_count, spam_count, trash_count, draft_count, sent_count, category_counts, error_message, started_at, completed_at, updated_at, email_accounts(email)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (emailAccountId) {
    query = query.eq("email_account_id", emailAccountId);
  }

  const { data } = await query.maybeSingle();
  if (!data) return null;

  await healScanSelections(supabase, userId, data.id);
  const live = await loadLiveScanAggregates(supabase, userId, data.id);

  const account = data.email_accounts as { email?: string } | null;

  return {
    id: data.id,
    emailAccountId: data.email_account_id,
    accountEmail: account?.email ?? "",
    status: data.status,
    // Prefer live message row count when available (excludes metadata fetch gaps).
    messagesProcessed: Math.max(
      data.messages_processed,
      live.messagesProcessedLive,
    ),
    totalEstimate: data.total_estimate,
    clutterCount: live.clutterCount,
    protectedCount: live.protectedCount,
    needsReviewCount: live.needsReviewCount,
    spamCount: live.spamCount,
    trashCount: live.trashCount,
    draftCount: data.draft_count,
    sentCount: data.sent_count,
    selectedCount: live.selectedCount,
    categoryCounts: live.categoryCounts,
    errorMessage: data.error_message,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    updatedAt: data.updated_at,
  };
}

export async function listGmailCleanerMessages(
  userId: string,
  scanId: string,
  filters: {
    category?: string | null;
    q?: string | null;
    action?: string | null;
    limit?: number;
  } = {},
): Promise<GmailCleanerMessageRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("gmail_cleaner_messages")
    .select("*")
    .eq("user_id", userId)
    .eq("scan_id", scanId)
    .order("message_date", { ascending: false, nullsFirst: false })
    .limit(filters.limit ?? 200);

  if (filters.category) {
    query = query.eq(
      "primary_category",
      filters.category as Database["public"]["Tables"]["gmail_cleaner_messages"]["Row"]["primary_category"],
    );
  }
  if (filters.action === "trash" || filters.action === "review" || filters.action === "keep") {
    query = query.eq("suggested_action", filters.action);
  }
  if (filters.q?.trim()) {
    const q = `%${filters.q.trim()}%`;
    query = query.or(
      `subject.ilike.${q},sender_email.ilike.${q},sender_name.ilike.${q}`,
    );
  }

  const { data } = await query;
  return (data ?? []).map((row) => ({
    id: row.id,
    gmailMessageId: row.gmail_message_id,
    gmailThreadId: row.gmail_thread_id,
    senderName: row.sender_name,
    senderEmail: row.sender_email,
    subject: row.subject,
    messageDate: row.message_date,
    labelIds: row.label_ids ?? [],
    sizeEstimate: row.size_estimate,
    primaryCategory: row.primary_category as GmailCleanerCategory,
    categoryLabel:
      CATEGORY_LABELS[row.primary_category as GmailCleanerCategory] ??
      row.primary_category,
    classificationReason: row.classification_reason,
    confidence: row.confidence,
    protectionStatus: row.protection_status,
    suggestedAction: row.suggested_action,
    selected: row.selected,
    isSpam: row.is_spam,
    isTrash: row.is_trash,
    isDraft: row.is_draft,
    isSent: row.is_sent,
  }));
}

export async function listGmailCleanerOperations(
  userId: string,
): Promise<GmailCleanerOperationSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gmail_cleaner_operations")
    .select(
      "id, status, action, selected_count, success_count, failed_count, skipped_count, category_summary, created_at, completed_at, email_accounts(email)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);

  return (data ?? []).map((row) => {
    const account = row.email_accounts as { email?: string } | null;
    return {
      id: row.id,
      accountEmail: account?.email ?? "",
      status: row.status,
      action: row.action,
      selectedCount: row.selected_count,
      successCount: row.success_count,
      failedCount: row.failed_count,
      skippedCount: row.skipped_count,
      categorySummary:
        row.category_summary && typeof row.category_summary === "object"
          ? (row.category_summary as Record<string, number>)
          : {},
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  });
}

export async function listGmailCleanerOperationItems(
  userId: string,
  operationId: string,
): Promise<GmailCleanerOperationItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("gmail_cleaner_operation_items")
    .select(
      "id, gmail_message_id, subject, sender_email, primary_category, status, error_message, was_already_trash, restored_at",
    )
    .eq("user_id", userId)
    .eq("operation_id", operationId)
    .order("created_at", { ascending: true })
    .limit(500);

  return (data ?? []).map((row) => ({
    id: row.id,
    gmailMessageId: row.gmail_message_id,
    subject: row.subject,
    senderEmail: row.sender_email,
    primaryCategory: row.primary_category,
    status: row.status,
    errorMessage: row.error_message,
    wasAlreadyTrash: row.was_already_trash,
    restoredAt: row.restored_at,
  }));
}

export async function getGmailCleanerPageData(
  userId: string,
  options: {
    accountId?: string | null;
    scanId?: string | null;
    category?: string | null;
    q?: string | null;
    action?: string | null;
    operationId?: string | null;
  } = {},
) {
  const accounts = await listGmailCleanerAccounts(userId);
  const selectedAccountId =
    options.accountId && accounts.some((a) => a.id === options.accountId)
      ? options.accountId
      : accounts[0]?.id ?? null;

  const latestScan = selectedAccountId
    ? await getLatestGmailCleanerScan(userId, selectedAccountId)
    : null;

  const activeScanId =
    options.scanId && latestScan && options.scanId === latestScan.id
      ? options.scanId
      : latestScan?.id ?? null;

  // Prefer explicit scanId if it belongs to the user
  let scan = latestScan;
  if (options.scanId && options.scanId !== latestScan?.id) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("gmail_cleaner_scans")
      .select("id")
      .eq("id", options.scanId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) {
      scan = await getLatestGmailCleanerScan(userId, selectedAccountId);
      // load that specific scan via a second path
      const { data: specific } = await supabase
        .from("gmail_cleaner_scans")
        .select(
          "id, email_account_id, status, messages_processed, total_estimate, clutter_count, protected_count, needs_review_count, spam_count, trash_count, draft_count, sent_count, category_counts, error_message, started_at, completed_at, updated_at, email_accounts(email)",
        )
        .eq("id", options.scanId)
        .eq("user_id", userId)
        .maybeSingle();
      if (specific) {
        await healScanSelections(supabase, userId, specific.id);
        const live = await loadLiveScanAggregates(
          supabase,
          userId,
          specific.id,
        );
        const account = specific.email_accounts as { email?: string } | null;
        scan = {
          id: specific.id,
          emailAccountId: specific.email_account_id,
          accountEmail: account?.email ?? "",
          status: specific.status,
          messagesProcessed: Math.max(
            specific.messages_processed,
            live.messagesProcessedLive,
          ),
          totalEstimate: specific.total_estimate,
          clutterCount: live.clutterCount,
          protectedCount: live.protectedCount,
          needsReviewCount: live.needsReviewCount,
          spamCount: live.spamCount,
          trashCount: live.trashCount,
          draftCount: specific.draft_count,
          sentCount: specific.sent_count,
          selectedCount: live.selectedCount,
          categoryCounts: live.categoryCounts,
          errorMessage: specific.error_message,
          startedAt: specific.started_at,
          completedAt: specific.completed_at,
          updatedAt: specific.updated_at,
        };
      }
    }
  }

  const messages = scan
    ? await listGmailCleanerMessages(userId, scan.id, {
        category: options.category,
        q: options.q,
        action: options.action,
      })
    : [];

  const operations = await listGmailCleanerOperations(userId);
  const operationItems =
    options.operationId
      ? await listGmailCleanerOperationItems(userId, options.operationId)
      : [];

  return {
    accounts,
    selectedAccountId,
    scan,
    activeScanId: scan?.id ?? activeScanId,
    messages,
    operations,
    operationItems,
    selectedOperationId: options.operationId ?? null,
  };
}
