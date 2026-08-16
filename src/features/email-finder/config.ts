/**
 * Bounded Email Finder configuration.
 * Defaults keep scans responsive on serverless hosts while allowing a real
 * deep crawl of contact, about, team, and policy pages.
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
  /** Optional Playwright fallback for JS-heavy pages (off by default). */
  browserFallback: boolean;
  browserTimeoutMs: number;
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

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/**
 * Bulk scanning still budgets each site tightly enough for serverless, but deep
 * enough to reach contact / team / policy pages discovered from the homepage.
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
  retryBackoffMs: number;
};

export function getEmailFinderBatchConfig(): EmailFinderBatchConfig {
  return {
    maxPagesPerSite: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_PAGES_PER_SITE ??
        process.env.EMAIL_FINDER_MAX_PAGES_PER_DOMAIN,
      12,
      1,
      20,
    ),
    maxDepth: readPositiveInt(process.env.EMAIL_FINDER_BATCH_MAX_DEPTH, 2, 0, 3),
    siteBudgetMs: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_SITE_BUDGET_MS,
      28_000,
      3_000,
      50_000,
    ),
    siteConcurrency: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_SITE_CONCURRENCY ??
        process.env.EMAIL_FINDER_URL_CONCURRENCY,
      5,
      1,
      8,
    ),
    pageConcurrency: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_PAGE_CONCURRENCY ??
        process.env.EMAIL_FINDER_PAGE_CONCURRENCY,
      3,
      1,
      5,
    ),
    maxAttempts: readPositiveInt(process.env.EMAIL_FINDER_BATCH_MAX_ATTEMPTS, 3, 1, 5),
    staleClaimMs: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_STALE_CLAIM_MS,
      300_000,
      60_000,
      1_800_000,
    ),
    targetsPerRun: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_TARGETS_PER_RUN,
      40,
      1,
      200,
    ),
    batchesPerRun: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_BATCHES_PER_RUN,
      5,
      1,
      20,
    ),
    retryBackoffMs: readPositiveInt(
      process.env.EMAIL_FINDER_BATCH_RETRY_BACKOFF_MS,
      1_500,
      0,
      10_000,
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
      process.env.EMAIL_FINDER_MAX_PAGES_PER_SCAN ??
        process.env.EMAIL_FINDER_MAX_PAGES_PER_DOMAIN,
      15,
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
      process.env.EMAIL_FINDER_REQUEST_TIMEOUT ??
        process.env.EMAIL_FINDER_TIMEOUT_MS,
      12_000,
      1_000,
      20_000,
    ),
    maxResponseBytes: readPositiveInt(
      process.env.EMAIL_FINDER_MAX_RESPONSE_SIZE ??
        process.env.EMAIL_FINDER_MAX_RESPONSE_BYTES,
      1_500_000,
      50_000,
      2_500_000,
    ),
    maxScanDurationMs: readPositiveInt(
      process.env.EMAIL_FINDER_MAX_SCAN_DURATION_MS,
      50_000,
      5_000,
      55_000,
    ),
    concurrency: readPositiveInt(
      process.env.EMAIL_FINDER_CONCURRENCY ??
        process.env.EMAIL_FINDER_PAGE_CONCURRENCY,
      3,
      1,
      5,
    ),
    userAgent:
      process.env.EMAIL_FINDER_USER_AGENT?.trim() ||
      "MhenbulkEmailFinder/1.0 (+https://mhenbulk.vercel.app)",
    browserFallback: readBool(process.env.EMAIL_FINDER_BROWSER_FALLBACK, false),
    browserTimeoutMs: readPositiveInt(
      process.env.EMAIL_FINDER_BROWSER_TIMEOUT_MS,
      12_000,
      3_000,
      25_000,
    ),
  };
}
