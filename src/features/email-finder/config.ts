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
