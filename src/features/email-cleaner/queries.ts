import { listDraftCampaignOptions } from "@/features/email-finder/queries";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type JobRow = Database["public"]["Tables"]["email_cleaning_jobs"]["Row"];
type ResultRow = Database["public"]["Tables"]["email_cleaning_results"]["Row"];

export type EmailCleanerJob = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  source: string;
  keepMode: "first" | "last";
  total: number;
  processed: number;
  counts: {
    valid: number;
    corrected: number;
    duplicate: number;
    invalid: number;
    suspicious: number;
    review: number;
  };
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type EmailCleanerResult = {
  id: string;
  rowIndex: number;
  selected: boolean;
  originalEmail: string;
  cleanEmail: string | null;
  status: string;
  issue: string;
  suggestedCorrection: string | null;
  confidence: number | null;
  reviewDecision: string | null;
  extra: Record<string, unknown>;
};

function mapJob(row: JobRow): EmailCleanerJob {
  return {
    id: row.id,
    status: row.status as EmailCleanerJob["status"],
    source: row.source ?? "paste",
    keepMode: row.keep_mode === "last" ? "last" : "first",
    total: row.total_records ?? 0,
    processed: row.processed_records ?? 0,
    counts: {
      valid: row.valid_count ?? 0,
      corrected: row.corrected_count ?? 0,
      duplicate: row.duplicate_count ?? 0,
      invalid: row.invalid_count ?? 0,
      suspicious: row.suspicious_count ?? 0,
      review: row.review_count ?? 0,
    },
    error: row.error_message ?? null,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
  };
}

function mapResult(row: ResultRow): EmailCleanerResult {
  return {
    id: row.id,
    rowIndex: row.row_index ?? 0,
    selected: Boolean(row.selected),
    originalEmail: row.original_email ?? "",
    cleanEmail: row.clean_email ?? null,
    status: row.status ?? "INVALID",
    issue: row.issue ?? "",
    suggestedCorrection: row.suggested_correction ?? null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    reviewDecision: row.review_decision ?? null,
    extra:
      row.extra && typeof row.extra === "object" && !Array.isArray(row.extra)
        ? (row.extra as Record<string, unknown>)
        : {},
  };
}

export async function listEmailCleanerJobs(userId: string): Promise<EmailCleanerJob[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("email_cleaning_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? []).map(mapJob);
}

export async function getEmailCleanerJob(
  userId: string,
  jobId: string,
): Promise<EmailCleanerJob | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("email_cleaning_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return mapJob(data);
}

export async function listEmailCleanerResults(
  userId: string,
  jobId: string,
): Promise<EmailCleanerResult[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("email_cleaning_results")
    .select("*")
    .eq("job_id", jobId)
    .eq("user_id", userId)
    .order("row_index", { ascending: true })
    .limit(10000);
  return (data ?? []).map(mapResult);
}

export async function getEmailCleanerPageData(userId: string, jobId?: string) {
  const [jobs, draftCampaigns, job, results] = await Promise.all([
    listEmailCleanerJobs(userId),
    listDraftCampaignOptions(userId),
    jobId ? getEmailCleanerJob(userId, jobId) : Promise.resolve(null),
    jobId ? listEmailCleanerResults(userId, jobId) : Promise.resolve([]),
  ]);
  return { jobs, draftCampaigns, job, results };
}
