import { hasGmailModifyScope } from "@/lib/google/scopes";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import type { GmailCleanerCategory } from "@/features/gmail-cleaner/classify";
import { CATEGORY_LABELS } from "@/features/gmail-cleaner/classify";

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

function emptyCounts(): Record<GmailCleanerCategory, number> {
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

function parseCounts(value: unknown): Record<GmailCleanerCategory, number> {
  const base = emptyCounts();
  if (!value || typeof value !== "object") return base;
  for (const key of Object.keys(base) as GmailCleanerCategory[]) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === "number" && Number.isFinite(raw)) base[key] = raw;
  }
  return base;
}

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

  const { count: selectedCount } = await supabase
    .from("gmail_cleaner_messages")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("scan_id", data.id)
    .eq("selected", true);

  const account = data.email_accounts as { email?: string } | null;

  return {
    id: data.id,
    emailAccountId: data.email_account_id,
    accountEmail: account?.email ?? "",
    status: data.status,
    messagesProcessed: data.messages_processed,
    totalEstimate: data.total_estimate,
    clutterCount: data.clutter_count,
    protectedCount: data.protected_count,
    needsReviewCount: data.needs_review_count,
    spamCount: data.spam_count,
    trashCount: data.trash_count,
    draftCount: data.draft_count,
    sentCount: data.sent_count,
    selectedCount: selectedCount ?? 0,
    categoryCounts: parseCounts(data.category_counts),
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
        const { count: selectedCount } = await supabase
          .from("gmail_cleaner_messages")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("scan_id", specific.id)
          .eq("selected", true);
        const account = specific.email_accounts as { email?: string } | null;
        scan = {
          id: specific.id,
          emailAccountId: specific.email_account_id,
          accountEmail: account?.email ?? "",
          status: specific.status,
          messagesProcessed: specific.messages_processed,
          totalEstimate: specific.total_estimate,
          clutterCount: specific.clutter_count,
          protectedCount: specific.protected_count,
          needsReviewCount: specific.needs_review_count,
          spamCount: specific.spam_count,
          trashCount: specific.trash_count,
          draftCount: specific.draft_count,
          sentCount: specific.sent_count,
          selectedCount: selectedCount ?? 0,
          categoryCounts: parseCounts(specific.category_counts),
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
