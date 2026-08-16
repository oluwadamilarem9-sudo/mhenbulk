import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailFinderResultRow } from "@/features/email-finder/queries";
import { createClient } from "@/lib/supabase/server";
import type {
  Database,
  EmailFinderBatchStatus,
  EmailFinderCategory,
  EmailFinderConfidence,
  EmailFinderTargetStatus,
} from "@/lib/supabase/database.types";

type AppSupabaseClient = SupabaseClient<Database>;

/** Aggregated batch results are capped so the results table stays responsive. */
export const BATCH_RESULT_LIMIT = 2_000;

export type EmailFinderBatchSummary = {
  id: string;
  name: string;
  status: EmailFinderBatchStatus;
  totalTargets: number;
  processedTargets: number;
  failedTargets: number;
  emailsFound: number;
  createdAt: string;
  completedAt: string | null;
};

export type EmailFinderBatchProgress = EmailFinderBatchSummary & {
  queuedTargets: number;
  runningTargets: number;
  /** Scanned successfully but published no address. */
  emptyTargets: number;
  /** Domains currently claimed by a worker. */
  currentlyScanning: string[];
  customPaths: string[];
  ownerGradeOnly: boolean;
  deepCrawl: boolean;
};

export type EmailFinderBatchFailure = {
  id: string;
  domain: string;
  errorMessage: string | null;
};

export type EmailFinderBatchDetail = {
  batch: EmailFinderBatchProgress;
  results: EmailFinderResultRow[];
  failures: EmailFinderBatchFailure[];
  truncated: boolean;
};

type BatchRow = {
  id: string;
  name: string;
  status: EmailFinderBatchStatus;
  total_targets: number;
  processed_targets: number;
  failed_targets: number;
  emails_found: number;
  custom_paths?: string[] | null;
  owner_grade_only?: boolean | null;
  deep_crawl?: boolean | null;
  created_at: string;
  completed_at: string | null;
};

const BATCH_COLUMNS =
  "id, name, status, total_targets, processed_targets, failed_targets, emails_found, custom_paths, owner_grade_only, deep_crawl, created_at, completed_at";

function mapBatch(row: BatchRow): EmailFinderBatchSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    totalTargets: row.total_targets,
    processedTargets: row.processed_targets,
    failedTargets: row.failed_targets,
    emailsFound: row.emails_found,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

async function countTargets(
  supabase: AppSupabaseClient,
  batchId: string,
  status: EmailFinderTargetStatus,
): Promise<number> {
  const { count } = await supabase
    .from("email_finder_batch_targets")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .eq("status", status);
  return count ?? 0;
}

export async function listEmailFinderBatches(
  userId: string,
  limit = 10,
): Promise<EmailFinderBatchSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("email_finder_batches")
    .select(BATCH_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map(mapBatch);
}

export async function getBatchProgress(
  supabase: AppSupabaseClient,
  userId: string,
  batchId: string,
): Promise<EmailFinderBatchProgress | null> {
  const { data: batch } = await supabase
    .from("email_finder_batches")
    .select(BATCH_COLUMNS)
    .eq("id", batchId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!batch) return null;

  const [queued, running, empty, active] = await Promise.all([
    countTargets(supabase, batchId, "queued"),
    countTargets(supabase, batchId, "running"),
    supabase
      .from("email_finder_batch_targets")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .eq("status", "completed")
      .eq("emails_found", 0),
    supabase
      .from("email_finder_batch_targets")
      .select("domain")
      .eq("batch_id", batchId)
      .eq("status", "running")
      .limit(8),
  ]);

  return {
    ...mapBatch(batch),
    queuedTargets: queued,
    runningTargets: running,
    emptyTargets: empty.count ?? 0,
    currentlyScanning: (active.data ?? []).map((row) => row.domain),
    customPaths: batch.custom_paths ?? [],
    ownerGradeOnly: batch.owner_grade_only ?? false,
    deepCrawl: batch.deep_crawl ?? true,
  };
}

export async function getEmailFinderBatchDetail(
  userId: string,
  batchId: string,
): Promise<EmailFinderBatchDetail | null> {
  const supabase = await createClient();
  const progress = await getBatchProgress(supabase, userId, batchId);
  if (!progress) return null;

  const [{ data: results }, { data: failures }] = await Promise.all([
    supabase
      .from("email_finder_results")
      .select(
        "id, scan_id, email, domain, source_url, source_urls, source_page_title, category, confidence, selected, added_to_contacts, contact_id, created_at",
      )
      .eq("user_id", userId)
      .eq("batch_id", batchId)
      .order("email", { ascending: true })
      .limit(BATCH_RESULT_LIMIT + 1),
    supabase
      .from("email_finder_batch_targets")
      .select("id, domain, error_message")
      .eq("user_id", userId)
      .eq("batch_id", batchId)
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);

  const rows = results ?? [];
  const truncated = rows.length > BATCH_RESULT_LIMIT;

  // One website can publish the same address on several pages, and different
  // websites can share an address; keep the first occurrence of each.
  const deduped: EmailFinderResultRow[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(0, BATCH_RESULT_LIMIT)) {
    const key = row.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const domain = row.domain || row.email.split("@")[1] || "";
    const sourceUrls =
      row.source_urls && row.source_urls.length > 0
        ? row.source_urls
        : [row.source_url];
    deduped.push({
      id: row.id,
      scanId: row.scan_id,
      email: row.email,
      domain,
      sourceUrl: row.source_url,
      sourceUrls,
      sourcePageTitle: row.source_page_title ?? null,
      category: row.category as EmailFinderCategory,
      confidence: (row.confidence as EmailFinderConfidence | null) ?? "medium",
      selected: row.selected,
      addedToContacts: row.added_to_contacts,
      contactId: row.contact_id,
      createdAt: row.created_at,
    });
  }

  return {
    batch: progress,
    results: deduped,
    failures: (failures ?? []).map((row) => ({
      id: row.id,
      domain: row.domain,
      errorMessage: row.error_message,
    })),
    truncated,
  };
}
