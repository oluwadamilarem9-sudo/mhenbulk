import { fetchRenderedHtml } from "@/features/email-finder/browser-fallback";
import { finderDebug, finderInfo } from "@/features/email-finder/debug";
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
import { parseSitemapUrls } from "@/features/email-finder/sitemap";
import {
  SafeUrlError,
  canonicalizeCrawlUrl,
  sameHost,
  validatePublicHttpUrl,
} from "@/features/email-finder/url-security";

/**
 * Conventional public contact pages. Curated — not an exhaustive path guesser.
 * These are ordinary pages a visitor can open; nothing here invents an address.
 */
export const CANDIDATE_CONTACT_PATHS = [
  "/contact",
  "/contact-us",
  "/pages/contact",
  "/kontakt",
  "/impressum",
  "/imprint",
  "/policies/contact-information",
  "/about",
  "/about-us",
  "/team",
  "/our-team",
  "/staff",
  "/support",
  "/help",
  "/company",
  "/leadership",
  "/privacy",
  "/privacy-policy",
  "/terms",
  "/legal",
];

export type CrawlPageStatus = {
  url: string;
  label: string;
  state: "pending" | "scanning" | "done" | "skipped";
};

export type CrawlOptions = Partial<EmailFinderConfig> & {
  /** Extra same-host paths supplied by the user (e.g. /partners). */
  customPaths?: string[];
  /** When false, skip sitemap + seeded contact paths and only follow links. */
  deepCrawl?: boolean;
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
  debug?: {
    discoveredLinks: number;
    sitemapUrls: number;
    methods: string[];
  };
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
      http_unavailable: "The website is temporarily unavailable.",
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

function normalizeCustomPath(path: string, origin: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return canonicalizeCrawlUrl(trimmed);
  }
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return canonicalizeCrawlUrl(withSlash, origin);
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
    return null;
  }
}

async function loadSitemapCandidates(
  origin: string,
  hostname: string,
  userAgent: string,
  timeoutMs: number,
  maxBytes: number,
  maxRedirects: number,
): Promise<Array<{ href: string; priority: number }>> {
  try {
    const sitemapUrl = new URL("/sitemap.xml", origin).href;
    const response = await safeFetchHtml(sitemapUrl, {
      userAgent,
      timeoutMs,
      maxBytes: Math.min(maxBytes, 500_000),
      maxRedirects,
    });
    return parseSitemapUrls(response.body, hostname, origin, 40);
  } catch {
    return [];
  }
}

export async function crawlWebsiteForEmails(
  rawUrl: string,
  overrides?: CrawlOptions,
): Promise<{ ok: true; data: CrawlResult } | { ok: false; error: CrawlFailure }> {
  const { customPaths = [], deepCrawl = true, ...configOverrides } = overrides ?? {};
  const config = { ...getEmailFinderConfig(), ...configOverrides };
  const startedAt = Date.now();

  try {
    const seed = await validatePublicHttpUrl(rawUrl);
    finderInfo("Scan started", {
      domain: seed.hostname,
      target: seed.href,
      deepCrawl,
      maxPages: config.maxPagesPerScan,
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
    let sitemapUrls = 0;

    if (deepCrawl) {
      for (const path of CANDIDATE_CONTACT_PATHS) {
        const candidate = canonicalizeCrawlUrl(path, seed.origin);
        if (candidate && candidate !== seed.href) {
          queue.push({ url: candidate, depth: 1, priority: 60 });
        }
      }

      const sitemap = await loadSitemapCandidates(
        seed.origin,
        seed.hostname,
        config.userAgent,
        config.requestTimeoutMs,
        config.maxResponseBytes,
        config.maxRedirects,
      );
      sitemapUrls = sitemap.length;
      for (const entry of sitemap) {
        queue.push({ url: entry.href, depth: 1, priority: 50 + entry.priority });
      }
    }

    for (const path of customPaths) {
      const candidate = normalizeCustomPath(path, seed.origin);
      if (!candidate) continue;
      try {
        if (!sameHost(new URL(candidate).hostname, seed.hostname)) continue;
      } catch {
        continue;
      }
      queue.push({ url: candidate, depth: 1, priority: 80 });
    }

    const visited = new Set<string>();
    const scannedPages: string[] = [];
    const discovered: ExtractedEmail[] = [];
    let javascriptHint = false;
    let limitReached = false;
    let softWarning: string | undefined;
    let firstFailure: unknown = null;
    let discoveredLinks = 0;

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

            let body = "";
            let finalUrl = item.url;

            try {
              const page = await safeFetchHtml(item.url, {
                userAgent: config.userAgent,
                timeoutMs: config.requestTimeoutMs,
                maxBytes: config.maxResponseBytes,
                maxRedirects: config.maxRedirects,
              });
              body = page.body;
              finalUrl = page.finalUrl;
            } catch (fetchError) {
              // Seed page hard-fails unless a browser fallback recovers it.
              if (item.depth === 0 && config.browserFallback) {
                const rendered = await fetchRenderedHtml(item.url, {
                  timeoutMs: config.browserTimeoutMs,
                  userAgent: config.userAgent,
                });
                if (!rendered) throw fetchError;
                body = rendered.html;
                finalUrl = rendered.finalUrl;
              } else {
                throw fetchError;
              }
            }

            const finalHost = new URL(finalUrl).hostname;
            if (!sameHost(finalHost, seed.hostname)) {
              return;
            }

            let extracted = extractEmailsAndLinks(body, finalUrl, seed.hostname);

            // JS-heavy pages with no public addresses: optional browser pass.
            if (
              extracted.emails.length === 0 &&
              extracted.javascriptHint &&
              config.browserFallback &&
              item.depth <= 1
            ) {
              const rendered = await fetchRenderedHtml(finalUrl, {
                timeoutMs: config.browserTimeoutMs,
                userAgent: config.userAgent,
              });
              if (rendered) {
                extracted = extractEmailsAndLinks(
                  rendered.html,
                  rendered.finalUrl,
                  seed.hostname,
                );
                finalUrl = rendered.finalUrl;
              }
            }

            scannedPages.push(finalUrl);
            discovered.push(...extracted.emails);
            if (extracted.javascriptHint) javascriptHint = true;
            discoveredLinks += extracted.links.length;

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
            if (item.depth === 0 && !firstFailure) {
              firstFailure = error;
            }
            console.info("[email-finder] Skipped page", {
              url: item.url,
              reason:
                error instanceof SafeFetchError || error instanceof SafeUrlError
                  ? error.code
                  : "unknown",
            });
            finderDebug("skipped_page", {
              url: item.url,
              depth: item.depth,
              reason:
                error instanceof SafeFetchError || error instanceof SafeUrlError
                  ? error.code
                  : "unknown",
            });
          }
        }),
      );
    }

    if (scannedPages.length === 0) {
      return {
        ok: false,
        error: toFailure(
          firstFailure ??
            new SafeFetchError("network_error", "We couldn't access this website."),
        ),
      };
    }

    if (queue.length > 0 && !limitReached) {
      limitReached = true;
      softWarning = "We reached the maximum number of pages for this scan.";
    }

    const emails = dedupeEmails(discovered);
    const methods = [...new Set(emails.flatMap((item) => item.methods))];

    finderInfo("Scan completed", {
      domain: seed.hostname,
      pages: scannedPages.length,
      emails: emails.length,
      sitemapUrls,
      methods,
      limitReached,
    });
    finderDebug("scan_detail", {
      domain: seed.hostname,
      scannedPages,
      discoveredLinks,
      emailsFound: emails.length,
      methods,
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
        debug: {
          discoveredLinks,
          sitemapUrls,
          methods,
        },
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
