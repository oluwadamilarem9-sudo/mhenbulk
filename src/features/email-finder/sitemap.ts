/**
 * Lightweight sitemap.xml reader for same-host contact-page discovery.
 * Caps entries and only keeps contact/about/team/support style URLs.
 */

import { canonicalizeCrawlUrl, sameHost } from "@/features/email-finder/url-security";

const PRIORITY_SITEMAP = [
  "contact",
  "kontakt",
  "about",
  "team",
  "staff",
  "support",
  "sales",
  "company",
  "people",
  "leadership",
  "impressum",
  "imprint",
  "privacy",
  "help",
];

export function parseSitemapUrls(
  xml: string,
  rootHostname: string,
  origin: string,
  limit = 40,
): Array<{ href: string; priority: number }> {
  const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((match) =>
    decodeXml(match[1].trim()),
  );

  const scored: Array<{ href: string; priority: number }> = [];
  const seen = new Set<string>();

  for (const loc of locs) {
    const absolute = canonicalizeCrawlUrl(loc, origin);
    if (!absolute) continue;
    try {
      const url = new URL(absolute);
      if (!sameHost(url.hostname, rootHostname)) continue;
      if (!/^https?:$/i.test(url.protocol)) continue;
      if (seen.has(absolute)) continue;
      seen.add(absolute);

      const haystack = `${url.pathname}${url.search}`.toLowerCase();
      let priority = 0;
      for (const keyword of PRIORITY_SITEMAP) {
        if (haystack.includes(keyword)) priority += 12;
      }
      if (priority <= 0) continue;
      scored.push({ href: absolute, priority });
    } catch {
      // ignore invalid locs
    }
  }

  return scored.sort((a, b) => b.priority - a.priority).slice(0, limit);
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}
