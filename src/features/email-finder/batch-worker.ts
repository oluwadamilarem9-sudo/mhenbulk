/**
 * Background worker for queued website scans.
 *
 * Runs are bounded by a wall-clock budget and a target cap so they finish well
 * inside serverless limits. Targets are claimed with a conditional update, so
 * the cron schedule and an on-page driver can run at the same time without
 * scanning the same website twice.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { getEmailFinderBatchConfig } from "@/features/email-finder/config";
import { crawlWebsiteForEmails } from "@/features/email-finder/crawler";
import {
  persistCompletedScan,
  persistFailedScan,
} from "@/features/email-finder/persist";
import type { Database } from "@/lib/supabase/database.types";

type AppSupabaseClient = SupabaseClient<Database>;

type Scope = {
  userId?: string;
  batchId?: string;
};

export type BatchRunSummary = {
  claimed: number;
  completed: number;
  failed: number;
  retried: number;
  emailsFound: number;
  remaining: number;
  durationMs: number;
};

type ClaimedTarget = {
  id: string;
  user_id: string;
  batch_id: string;
  url: string;
  domain: string;
  attempts: number;
};

/** Transient problems deserve another attempt; permanent ones do not. */
const RETRYABLE_CODES = new Set([
  "timeout",
  "network_error",
  "http_rate_limited",
  "dns_failed",
  "scan_failed",
]);

const ACTIVE_BATCH_STATUSES = ["pending", "running"] as const;

async function listActiveBatchIds(
  supabase: AppSupabaseClient,
  scope: Scope,
  limit: number,
): Promise<string[]> {
  const query = supabase
    .from("email_finder_batches")
    .select("id")
    .in("status", [...ACTIVE_BATCH_STATUSES])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (scope.userId) query.eq("user_id", scope.userId);
  if (scope.batchId) query.eq("id", scope.batchId);

  const { data } = await query;
  return (data ?? []).map((row) => row.id);
}

/**
 * Returns targets stuck in `running` (for example a crashed run) to the queue,
 * or fails them once they are out of attempts.
 */
async function recoverStaleTargets(
  supabase: AppSupabaseClient,
  scope: Scope,
  staleClaimMs: number,
  maxAttempts: number,
) {
  const threshold = new Date(Date.now() - staleClaimMs).toISOString();
  const query = supabase
    .from("email_finder_batch_targets")
    .select("id, attempts")
    .eq("status", "running")
    .lt("claimed_at", threshold)
    .limit(100);

  if (scope.userId) query.eq("user_id", scope.userId);
  if (scope.batchId) query.eq("batch_id", scope.batchId);

  const { data: stale } = await query;

  for (const target of stale ?? []) {
    const exhausted = target.attempts >= maxAttempts;
    await supabase
      .from("email_finder_batch_targets")
      .update(
        exhausted
          ? {
              status: "failed",
              claimed_at: null,
              completed_at: new Date().toISOString(),
              error_code: "scan_failed",
              error_message: "The scan did not finish. Please try again.",
            }
          : { status: "queued", claimed_at: null },
      )
      .eq("id", target.id)
      .eq("status", "running");
  }
}

async function claimTargets(
  supabase: AppSupabaseClient,
  batchIds: string[],
  limit: number,
): Promise<ClaimedTarget[]> {
  const { data: candidates } = await supabase
    .from("email_finder_batch_targets")
    .select("id, user_id, batch_id, url, domain, attempts")
    .in("batch_id", batchIds)
    .eq("status", "queued")
    .order("position", { ascending: true })
    .limit(limit * 3);

  const claimed: ClaimedTarget[] = [];
  const now = new Date().toISOString();

  for (const candidate of candidates ?? []) {
    if (claimed.length >= limit) break;

    const { data: locked } = await supabase
      .from("email_finder_batch_targets")
      .update({
        status: "running",
        claimed_at: now,
        attempts: candidate.attempts + 1,
      })
      .eq("id", candidate.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();

    if (locked) {
      claimed.push({ ...candidate, attempts: candidate.attempts + 1 });
    }
  }

  return claimed;
}

async function markBatchesRunning(
  supabase: AppSupabaseClient,
  batchIds: string[],
) {
  if (!batchIds.length) return;
  await supabase
    .from("email_finder_batches")
    .update({ status: "running", started_at: new Date().toISOString() })
    .in("id", batchIds)
    .eq("status", "pending");
}

async function countTargets(
  supabase: AppSupabaseClient,
  batchId: string,
  statuses: Database["public"]["Enums"]["email_finder_target_status"][],
): Promise<number> {
  const { count } = await supabase
    .from("email_finder_batch_targets")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .in("status", statuses);
  return count ?? 0;
}

/** Recomputes counters from the targets table so retries never double-count. */
async function refreshBatchProgress(
  supabase: AppSupabaseClient,
  batchId: string,
): Promise<number> {
  const [pending, processed, failed, emailRows, batch] = await Promise.all([
    countTargets(supabase, batchId, ["queued", "running"]),
    countTargets(supabase, batchId, ["completed", "failed", "skipped"]),
    countTargets(supabase, batchId, ["failed"]),
    supabase
      .from("email_finder_batch_targets")
      .select("emails_found")
      .eq("batch_id", batchId)
      .gt("emails_found", 0),
    supabase
      .from("email_finder_batches")
      .select("status")
      .eq("id", batchId)
      .maybeSingle(),
  ]);

  const emailsFound = (emailRows.data ?? []).reduce(
    (total, row) => total + row.emails_found,
    0,
  );

  const currentStatus = batch.data?.status;
  const finished =
    pending === 0 && currentStatus !== "paused" && currentStatus !== "cancelled";

  await supabase
    .from("email_finder_batches")
    .update({
      processed_targets: processed,
      failed_targets: failed,
      emails_found: emailsFound,
      ...(finished
        ? { status: "completed", completed_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", batchId);

  return pending;
}

async function processTarget(
  supabase: AppSupabaseClient,
  target: ClaimedTarget,
  config: ReturnType<typeof getEmailFinderBatchConfig>,
): Promise<{ outcome: "completed" | "failed" | "retried"; emails: number }> {
  const crawl = await crawlWebsiteForEmails(target.url, {
    maxPagesPerScan: config.maxPagesPerSite,
    maxDepth: config.maxDepth,
    maxScanDurationMs: config.siteBudgetMs,
    concurrency: config.pageConcurrency,
  });

  if (!crawl.ok) {
    const retryable =
      RETRYABLE_CODES.has(crawl.error.code) && target.attempts < config.maxAttempts;

    if (retryable) {
      await supabase
        .from("email_finder_batch_targets")
        .update({
          status: "queued",
          claimed_at: null,
          error_code: crawl.error.code,
          error_message: crawl.error.message,
        })
        .eq("id", target.id);
      return { outcome: "retried", emails: 0 };
    }

    const scanId = await persistFailedScan(supabase, {
      userId: target.user_id,
      targetUrl: target.url,
      domain: target.domain,
      code: crawl.error.code,
      message: crawl.error.message,
      batchId: target.batch_id,
    });

    await supabase
      .from("email_finder_batch_targets")
      .update({
        status: "failed",
        claimed_at: null,
        completed_at: new Date().toISOString(),
        scan_id: scanId,
        error_code: crawl.error.code,
        error_message: crawl.error.message,
      })
      .eq("id", target.id);

    return { outcome: "failed", emails: 0 };
  }

  const persisted = await persistCompletedScan(supabase, {
    userId: target.user_id,
    crawl: crawl.data,
    batchId: target.batch_id,
  });

  if (!persisted) {
    await supabase
      .from("email_finder_batch_targets")
      .update({
        status: "failed",
        claimed_at: null,
        completed_at: new Date().toISOString(),
        error_code: "scan_failed",
        error_message: "We couldn't save the results for this website.",
      })
      .eq("id", target.id);
    return { outcome: "failed", emails: 0 };
  }

  await supabase
    .from("email_finder_batch_targets")
    .update({
      status: "completed",
      claimed_at: null,
      completed_at: new Date().toISOString(),
      scan_id: persisted.scanId,
      emails_found: persisted.emailsFound,
      error_code: null,
      error_message: null,
    })
    .eq("id", target.id);

  return { outcome: "completed", emails: persisted.emailsFound };
}

export async function processEmailFinderBatches(
  supabase: AppSupabaseClient,
  options: Scope & { maxTargets?: number; budgetMs?: number } = {},
): Promise<BatchRunSummary> {
  const startedAt = Date.now();
  const config = getEmailFinderBatchConfig();
  const scope: Scope = { userId: options.userId, batchId: options.batchId };
  const maxTargets = options.maxTargets ?? config.targetsPerRun;
  const budgetMs = options.budgetMs ?? 45_000;

  const summary: BatchRunSummary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    emailsFound: 0,
    remaining: 0,
    durationMs: 0,
  };

  await recoverStaleTargets(
    supabase,
    scope,
    config.staleClaimMs,
    config.maxAttempts,
  );

  const touched = new Set<string>();

  while (
    summary.claimed < maxTargets &&
    Date.now() - startedAt < budgetMs - config.siteBudgetMs
  ) {
    const batchIds = await listActiveBatchIds(
      supabase,
      scope,
      config.batchesPerRun,
    );
    if (!batchIds.length) break;

    const slice = Math.min(config.siteConcurrency, maxTargets - summary.claimed);
    const targets = await claimTargets(supabase, batchIds, slice);
    if (!targets.length) break;

    await markBatchesRunning(supabase, [
      ...new Set(targets.map((target) => target.batch_id)),
    ]);

    summary.claimed += targets.length;
    for (const target of targets) touched.add(target.batch_id);

    const outcomes = await Promise.all(
      targets.map((target) => processTarget(supabase, target, config)),
    );

    for (const outcome of outcomes) {
      if (outcome.outcome === "completed") summary.completed += 1;
      else if (outcome.outcome === "failed") summary.failed += 1;
      else summary.retried += 1;
      summary.emailsFound += outcome.emails;
    }

    for (const batchId of touched) {
      await refreshBatchProgress(supabase, batchId);
    }
  }

  let remaining = 0;
  for (const batchId of touched) {
    remaining += await refreshBatchProgress(supabase, batchId);
  }

  if (!touched.size) {
    const batchIds = await listActiveBatchIds(
      supabase,
      scope,
      config.batchesPerRun,
    );
    for (const batchId of batchIds) {
      remaining += await refreshBatchProgress(supabase, batchId);
    }
  }

  summary.remaining = remaining;
  summary.durationMs = Date.now() - startedAt;

  if (summary.claimed) {
    console.info("[email-finder] Batch run completed", summary);
  }

  return summary;
}
