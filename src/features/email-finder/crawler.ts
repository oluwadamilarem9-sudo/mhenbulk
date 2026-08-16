import {
  getEmailFinderConfig,
  type EmailFinderConfig,
} from "@/features/email-finder/config";
import {
  dedupeEmails,
  extractEmailsAndLinks,
  type ExtractedEmail,
} from "@/features/email-finder/extract";
import {
  isCrawlRootBlocked,
  isPathAllowed,
  parseRobotsTxt,
  type RobotsRules,
} from "@/features/email-finder/robots";
import { SafeFetchError, safeFetchHtml } from "@/features/email-finder/safe-fetch";
import {
  SafeUrlError,
  sameHost,
  validatePublicHttpUrl,
} from "@/features/email-finder/url-security";

export type CrawlPageStatus = {
  url: string;
  label: string;
  state: "pending" | "scanning" | "done" | "skipped";
};

export type CrawlResult = {
  targetUrl: string;
  domain: string;
  pagesScanned: number;
  emails: ExtractedEmail[];
  scannedPages: string[];
  limitReached: boolean;
  javascriptHint: boolean;
  status: "completed" | "partial";
  warning?: string;
};

export type CrawlFailure = {
  code: string;
  message: string;
};

function pageLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" || parsed.pathname === "") return "Homepage";
    return parsed.pathname;
  } catch {
    return url;
  }
}

function toFailure(error: unknown): CrawlFailure {
  if (error instanceof SafeUrlError || error instanceof SafeFetchError) {
    const messages: Record<string, string> = {
      invalid_url: "Enter a valid HTTP or HTTPS URL.",
      unsupported_protocol: "Only HTTP and HTTPS websites can be scanned.",
      credentials_not_allowed: "URLs with usernames or passwords are not allowed.",
      port_not_allowed: "Only standard HTTP and HTTPS ports are allowed.",
      hostname_blocked: "This hostname cannot be scanned.",
      private_address: "Private or internal network addresses cannot be scanned.",
      dns_failed: "We couldn't resolve this website.",
      timeout: "The website took too long to respond.",
      too_many_redirects: "The website redirected too many times.",
      response_too_large: "A page was too large to scan safely.",
      unsupported_content_type: "Only HTML pages can be scanned.",
      http_forbidden: "The website blocked automated requests.",
      http_not_found: "We couldn't find that page.",
      http_rate_limited: "The website is rate-limiting requests. Try again later.",
      http_error: "We couldn't access this website.",
      network_error: "We couldn't access this website.",
      robots_blocked: "Website crawling is not allowed for this path.",
    };
    return {
      code: error.code,
      message: messages[error.code] ?? error.message,
    };
  }
  return {
    code: "scan_failed",
    message: "We couldn't complete this scan. Please try again.",
  };
}

async function loadRobots(
  origin: string,
  userAgent: string,
  timeoutMs: number,
  maxBytes: number,
  maxRedirects: number,
): Promise<RobotsRules | null> {
  try {
    const robotsUrl = new URL("/robots.txt", origin).href;
    const response = await safeFetchHtml(robotsUrl, {
      userAgent,
      timeoutMs,
      maxBytes: Math.min(maxBytes, 200_000),
      maxRedirects,
    });
    return parseRobotsTxt(response.body, userAgent);
  } catch (error) {
    if (
      error instanceof SafeFetchError &&
      (error.code === "http_not_found" ||
        error.code === "unsupported_content_type" ||
        error.code === "http_forbidden")
    ) {
      return null;
    }
    // Fail open on robots fetch network issues only after validating the origin.
    // Disallow decisions still apply when robots.txt is successfully loaded.
    return null;
  }
}

export async function crawlWebsiteForEmails(
  rawUrl: string,
  overrides?: Partial<EmailFinderConfig>,
): Promise<{ ok: true; data: CrawlResult } | { ok: false; error: CrawlFailure }> {
  const config = { ...getEmailFinderConfig(), ...overrides };
  const startedAt = Date.now();

  try {
    const seed = await validatePublicHttpUrl(rawUrl);
    console.info("[email-finder] Scan started", {
      domain: seed.hostname,
      target: seed.href,
    });

    const robots = await loadRobots(
      seed.origin,
      config.userAgent,
      config.requestTimeoutMs,
      config.maxResponseBytes,
      config.maxRedirects,
    );

    if (robots && isCrawlRootBlocked(robots)) {
      return {
        ok: false,
        error: {
          code: "robots_blocked",
          message: "Website crawling is not allowed for this path.",
        },
      };
    }

    if (robots && !isPathAllowed(robots, seed.pathname, seed.search)) {
      return {
        ok: false,
        error: {
          code: "robots_blocked",
          message: "Website crawling is not allowed for this path.",
        },
      };
    }

    type QueueItem = { url: string; depth: number; priority: number };
    const queue: QueueItem[] = [{ url: seed.href, depth: 0, priority: 100 }];
    const visited = new Set<string>();
    const scannedPages: string[] = [];
    const discovered: ExtractedEmail[] = [];
    let javascriptHint = false;
    let limitReached = false;
    let softWarning: string | undefined;

    while (queue.length > 0) {
      if (Date.now() - startedAt >= config.maxScanDurationMs) {
        limitReached = true;
        softWarning = "We reached the maximum scan time for this request.";
        break;
      }
      if (scannedPages.length >= config.maxPagesPerScan) {
        limitReached = true;
        softWarning = "We reached the maximum number of pages for this scan.";
        break;
      }

      queue.sort((a, b) => b.priority - a.priority || a.depth - b.depth);
      const batch = queue.splice(0, config.concurrency);
      const remainingSlots = config.maxPagesPerScan - scannedPages.length;
      const work = batch.slice(0, remainingSlots);

      await Promise.all(
        work.map(async (item) => {
          if (visited.has(item.url)) return;
          visited.add(item.url);

          try {
            const pageUrl = new URL(item.url);
            if (!sameHost(pageUrl.hostname, seed.hostname)) return;
            if (
              robots &&
              !isPathAllowed(robots, pageUrl.pathname, pageUrl.search)
            ) {
              return;
            }

            const page = await safeFetchHtml(item.url, {
              userAgent: config.userAgent,
              timeoutMs: config.requestTimeoutMs,
              maxBytes: config.maxResponseBytes,
              maxRedirects: config.maxRedirects,
            });

            const finalHost = new URL(page.finalUrl).hostname;
            if (!sameHost(finalHost, seed.hostname)) {
              return;
            }

            scannedPages.push(page.finalUrl);
            const extracted = extractEmailsAndLinks(
              page.body,
              page.finalUrl,
              seed.hostname,
            );
            discovered.push(...extracted.emails);
            if (extracted.javascriptHint) javascriptHint = true;

            if (item.depth < config.maxDepth) {
              for (const link of extracted.links) {
                if (visited.has(link.href)) continue;
                if (queue.some((queued) => queued.url === link.href)) continue;
                if (
                  robots &&
                  !isPathAllowed(
                    robots,
                    new URL(link.href).pathname,
                    new URL(link.href).search,
                  )
                ) {
                  continue;
                }
                queue.push({
                  url: link.href,
                  depth: item.depth + 1,
                  priority: link.priority,
                });
              }
            }
          } catch (error) {
            // Seed page hard-fails; secondary pages are skipped.
            if (item.depth === 0 && scannedPages.length === 0 && discovered.length === 0) {
              throw error;
            }
            console.info("[email-finder] Skipped page", {
              url: item.url,
              reason:
                error instanceof SafeFetchError || error instanceof SafeUrlError
                  ? error.code
                  : "unknown",
            });
          }
        }),
      );
    }

    if (queue.length > 0 && !limitReached) {
      limitReached = true;
      softWarning = "We reached the maximum number of pages for this scan.";
    }

    const emails = dedupeEmails(discovered);
    console.info("[email-finder] Scan completed", {
      domain: seed.hostname,
      pages: scannedPages.length,
      emails: emails.length,
      limitReached,
    });

    return {
      ok: true,
      data: {
        targetUrl: seed.href,
        domain: seed.hostname,
        pagesScanned: scannedPages.length,
        emails,
        scannedPages,
        limitReached,
        javascriptHint,
        status: limitReached ? "partial" : "completed",
        warning: softWarning,
      },
    };
  } catch (error) {
    const failure = toFailure(error);
    console.info("[email-finder] Scan failed", {
      code: failure.code,
    });
    return { ok: false, error: failure };
  }
}

export function describePageProgress(urls: string[]): CrawlPageStatus[] {
  return urls.map((url, index) => ({
    url,
    label: pageLabel(url),
    state: index === urls.length - 1 ? "scanning" : "done",
  }));
}
