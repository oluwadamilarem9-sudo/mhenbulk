/**
 * Bounded Email Finder configuration.
 * Defaults keep scans responsive on serverless hosts.
 */

export type EmailFinderConfig = {
  maxScansPerHour: number;
  maxPagesPerScan: number;
  maxDepth: number;
  maxRedirects: number;
  requestTimeoutMs: number;
  maxResponseBytes: number;
  maxScanDurationMs: number;
  concurrency: number;
  userAgent: string;
};

function readPositiveInt(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

/**
 * Bulk scanning trades depth for throughput: each site gets a short budget so a
 * single worker run can clear several sites instead of one slow one.
 */
export type EmailFinderBatchConfig = {
  maxPagesPerSite: number;
  maxDepth: number;
  siteBudgetMs: number;
  siteConcurrency: number;
  pageConcurrency: number;
  maxAttempts: number;
  staleClaimMs: number;
  targetsPerRun: number;
  batchesPerRun: number;
};

export function getEmailFinderBatchConfig(): EmailFinderBatchConfig {
  return {
    maxPagesPerSite: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_PAGES_PER_SITE,
      4,
      1,
      15,
    ),
    maxDepth: readPositiveInt(process.env.EMAIL_FINDER_BATCH_MAX_DEPTH, 1, 0, 3),
    siteBudgetMs: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_SITE_BUDGET_MS,
      14_000,
      3_000,
      40_000,
    ),
    siteConcurrency: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_SITE_CONCURRENCY,
      3,
      1,
      6,
    ),
    pageConcurrency: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_PAGE_CONCURRENCY,
      2,
      1,
      4,
    ),
    maxAttempts: readPositiveInt(process.env.EMAIL_FINDER_BATCH_MAX_ATTEMPTS, 2, 1, 5),
    staleClaimMs: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_STALE_CLAIM_MS,
      300_000,
      60_000,
      1_800_000,
    ),
    targetsPerRun: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_TARGETS_PER_RUN,
      30,
      1,
      200,
    ),
    batchesPerRun: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_BATCHES_PER_RUN,
      5,
      1,
      20,
    ),
  };
}

export function getEmailFinderConfig(): EmailFinderConfig {
  return {
    maxScansPerHour: readPositiveInt(
      process.env.EMAIL_FINDER_MAX_SCANS_PER_HOUR,
      20,
      1,
      200,
    ),
    maxPagesPerScan: readPositiveInt(
      process.env.EMAIL_FINDER_MAX_PAGES_PER_SCAN,
      10,
      1,
      25,
    ),
    maxDepth: readPositiveInt(process.env.EMAIL_FINDER_MAX_DEPTH, 2, 0, 4),
    maxRedirects: readPositiveInt(
      process.env.EMAIL_FINDER_MAX_REDIRECTS,
      5,
      0,
      10,
    ),
    requestTimeoutMs: readPositiveInt(
      process.env.EMAIL_FINDER_REQUEST_TIMEOUT,
      8_000,
      1_000,
      20_000,
    ),
    maxResponseBytes: readPositiveInt(
      process.env.EMAIL_FINDER_MAX_RESPONSE_SIZE,
      1_000_000,
      50_000,
      2_000_000,
    ),
    maxScanDurationMs: readPositiveInt(
      process.env.EMAIL_FINDER_MAX_SCAN_DURATION_MS,
      45_000,
      5_000,
      55_000,
    ),
    concurrency: readPositiveInt(
      process.env.EMAIL_FINDER_CONCURRENCY,
      2,
      1,
      4,
    ),
    userAgent:
      process.env.EMAIL_FINDER_USER_AGENT?.trim() ||
      "MhenbulkEmailFinder/1.0 (+https://mhenbulk.vercel.app)",
  };
}
