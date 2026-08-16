import * as cheerio from "cheerio";

import type { EmailFinderCategory } from "@/lib/supabase/database.types";
import { canonicalizeCrawlUrl, sameHost } from "@/features/email-finder/url-security";

const EMAIL_PATTERN =
  /(?:mailto:)?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;

const PRIORITY_KEYWORDS = [
  "contact",
  "about",
  "team",
  "staff",
  "support",
  "sales",
  "services",
  "company",
  "leadership",
  "careers",
  "people",
];

const GENERIC_LOCAL_PARTS = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "webmaster",
  "postmaster",
  "mailer-daemon",
  "daemon",
  "abuse",
  "privacy",
  "legal",
  "compliance",
  "newsletter",
  "notifications",
  "notification",
  "alerts",
  "bounce",
  "bounces",
]);

const BUSINESS_LOCAL_PARTS = new Set([
  "hello",
  "hi",
  "info",
  "contact",
  "contacts",
  "support",
  "help",
  "sales",
  "marketing",
  "press",
  "media",
  "hr",
  "jobs",
  "careers",
  "billing",
  "accounts",
  "office",
  "admin",
  "team",
  "service",
  "customerservice",
  "customer-service",
]);

export type ExtractedEmail = {
  email: string;
  sourceUrl: string;
  category: EmailFinderCategory;
};

export type PageExtraction = {
  emails: ExtractedEmail[];
  links: Array<{ href: string; priority: number }>;
  javascriptHint: boolean;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );
}

export function normalizeEmailCandidate(raw: string): string | null {
  let value = decodeEntities(raw).trim();
  value = value.replace(/^mailto:/i, "");
  const queryIndex = value.search(/[?&#]/);
  if (queryIndex >= 0) value = value.slice(0, queryIndex);
  value = value.replace(/^[\s<("'`[]+/, "").replace(/[\s>)"'`\],;:!?]+$/g, "");
  value = value.toLowerCase();

  if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(value)) {
    return null;
  }
  if (value.includes("..") || value.startsWith(".") || value.includes("@.")) {
    return null;
  }
  return value;
}

export function categorizeEmail(email: string): EmailFinderCategory {
  const local = email.split("@")[0] ?? "";
  const compact = local.replace(/[._\-]/g, "");
  if (
    GENERIC_LOCAL_PARTS.has(local) ||
    GENERIC_LOCAL_PARTS.has(compact) ||
    local.startsWith("noreply") ||
    local.startsWith("no-reply")
  ) {
    return "generic";
  }
  if (BUSINESS_LOCAL_PARTS.has(local) || BUSINESS_LOCAL_PARTS.has(compact)) {
    return "business";
  }
  if (local.includes(".") || local.includes("_") || /[a-z]+\d+$/i.test(local)) {
    return "personal";
  }
  return "business";
}

function scoreLink(href: string, text: string): number {
  const haystack = `${href} ${text}`.toLowerCase();
  let score = 0;
  for (const keyword of PRIORITY_KEYWORDS) {
    if (haystack.includes(keyword)) score += 10;
  }
  if (href === "/" || href.endsWith("/")) score += 1;
  return score;
}

export function extractEmailsAndLinks(
  html: string,
  pageUrl: string,
  rootHostname: string,
): PageExtraction {
  const $ = cheerio.load(html);
  const emails = new Map<string, ExtractedEmail>();
  const links = new Map<string, number>();

  $("script, style, noscript").remove();

  $("a[href]").each((_, element) => {
    const href = ($(element).attr("href") || "").trim();
    const text = $(element).text();
    if (/^mailto:/i.test(href)) {
      const email = normalizeEmailCandidate(href);
      if (email) {
        emails.set(email, {
          email,
          sourceUrl: pageUrl,
          category: categorizeEmail(email),
        });
      }
      return;
    }

    const absolute = canonicalizeCrawlUrl(href, pageUrl);
    if (!absolute) return;
    try {
      const url = new URL(absolute);
      if (!sameHost(url.hostname, rootHostname)) return;
      if (!/^https?:$/i.test(url.protocol)) return;
      const priority = scoreLink(`${url.pathname}${url.search}`, text);
      links.set(absolute, Math.max(links.get(absolute) ?? 0, priority));
    } catch {
      // ignore invalid links
    }
  });

  const bodyText = decodeEntities($.root().text());
  for (const match of bodyText.matchAll(EMAIL_PATTERN)) {
    const email = normalizeEmailCandidate(match[1] ?? match[0]);
    if (!email) continue;
    if (!emails.has(email)) {
      emails.set(email, {
        email,
        sourceUrl: pageUrl,
        category: categorizeEmail(email),
      });
    }
  }

  // Also scan raw HTML attributes that may contain mailto outside <a>.
  for (const match of html.matchAll(/mailto:([^\s"'<>]+)/gi)) {
    const email = normalizeEmailCandidate(match[1] ?? "");
    if (!email) continue;
    if (!emails.has(email)) {
      emails.set(email, {
        email,
        sourceUrl: pageUrl,
        category: categorizeEmail(email),
      });
    }
  }

  const javascriptHint =
    emails.size === 0 &&
    (/<script[\s>]/i.test(html) || /__NEXT_DATA__|ng-app|data-reactroot/i.test(html));

  return {
    emails: [...emails.values()],
    links: [...links.entries()]
      .map(([href, priority]) => ({ href, priority }))
      .sort((a, b) => b.priority - a.priority),
    javascriptHint,
  };
}

export function dedupeEmails(emails: ExtractedEmail[]): ExtractedEmail[] {
  const map = new Map<string, ExtractedEmail>();
  for (const item of emails) {
    const existing = map.get(item.email);
    if (!existing) {
      map.set(item.email, item);
      continue;
    }
    // Prefer a deeper / more specific source path when duplicates appear.
    if ((item.sourceUrl?.length ?? 0) > (existing.sourceUrl?.length ?? 0)) {
      map.set(item.email, item);
    }
  }
  return [...map.values()].sort((a, b) => a.email.localeCompare(b.email));
}
