import * as cheerio from "cheerio";

import type { EmailFinderCategory } from "@/lib/supabase/database.types";
import { canonicalizeCrawlUrl, sameHost } from "@/features/email-finder/url-security";

const EMAIL_PATTERN =
  /(?:mailto:)?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;

/** Contact-ish pages, including the German and Shopify conventions. */
const PRIORITY_KEYWORDS = [
  "contact",
  "kontakt",
  "impressum",
  "imprint",
  "about",
  "ueber-uns",
  "über-uns",
  "over-ons",
  "nosotros",
  "team",
  "staff",
  "support",
  "sales",
  "services",
  "company",
  "unternehmen",
  "leadership",
  "careers",
  "people",
  "legal",
  "policies",
  "privacy",
  "datenschutz",
  "help",
  "hilfe",
];

/** Pages that almost never publish an address but burn the page budget. */
const LOW_VALUE_PATTERNS = [
  "/cart",
  "/checkout",
  "/account",
  "/login",
  "/signin",
  "/register",
  "/wishlist",
  "/search",
  "/basket",
  "/feed",
  "/wp-json",
  "/wp-admin",
  "/tag/",
  "/tags/",
  "/category/",
  "/collections/",
  "/products/",
  "/product/",
  "/blogs/",
  "/blog/",
];

/** Placeholder and telemetry addresses that are never real contacts. */
const JUNK_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "yourdomain.com",
  "yourcompany.com",
  "email.com",
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
  "wix.com",
  "godaddy.com",
  "squarespace.com",
  "shopify.com",
  "myshopify.com",
  "cloudflare.com",
  "w3.org",
  "schema.org",
  "test.com",
  "mail.com",
]);

/**
 * Common endings used as a sanity check. Any two-letter country code is also
 * accepted, so this list only needs the gTLDs that show up in practice.
 */
const KNOWN_TLDS = new Set([
  "com",
  "net",
  "org",
  "info",
  "biz",
  "shop",
  "store",
  "online",
  "site",
  "web",
  "xyz",
  "dev",
  "app",
  "tech",
  "digital",
  "agency",
  "email",
  "media",
  "news",
  "today",
  "world",
  "group",
  "club",
  "life",
  "live",
  "studio",
  "design",
  "gmbh",
  "haus",
  "berlin",
  "hamburg",
  "koeln",
  "bayern",
  "nrw",
  "wien",
  "swiss",
  "paris",
  "london",
  "shopping",
  "boutique",
  "company",
  "solutions",
  "services",
  "consulting",
  "clinic",
  "coach",
  "expert",
  "photography",
  "travel",
  "gallery",
  "kitchen",
  "energy",
  "fitness",
  "care",
]);

/** Filenames caught by the address pattern, e.g. `logo@2x.png`. */
const ASSET_SUFFIXES = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "ico",
  "css",
  "js",
  "mjs",
  "json",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "mp4",
  "webm",
  "pdf",
]);

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

  const [local, domain] = value.split("@");
  const suffix = domain.split(".").pop() ?? "";
  if (ASSET_SUFFIXES.has(suffix)) return null;
  if (JUNK_DOMAINS.has(domain)) return null;
  if (domain.endsWith(".wixpress.com") || domain.endsWith(".sentry.io")) return null;
  // Hex blobs such as tracking ids that happen to contain an @.
  if (/^[0-9a-f]{16,}$/.test(local)) return null;
  // Sentence text glued to an address, e.g. `info@shop.comverbraucher...`.
  if (suffix.length > 12 && !KNOWN_TLDS.has(suffix)) return null;
  if (suffix.length > 2 && !KNOWN_TLDS.has(suffix) && !/^[a-z]{3,10}$/.test(suffix)) {
    return null;
  }

  return value;
}

/**
 * Cloudflare replaces addresses with a hex blob that the browser decodes.
 * The first byte is the XOR key for the remaining bytes.
 */
export function decodeCloudflareEmail(encoded: string): string | null {
  const hex = encoded.trim().toLowerCase();
  if (!/^[0-9a-f]{6,}$/.test(hex) || hex.length % 2 !== 0) return null;

  const key = Number.parseInt(hex.slice(0, 2), 16);
  let decoded = "";
  for (let index = 2; index < hex.length; index += 2) {
    const code = Number.parseInt(hex.slice(index, index + 2), 16) ^ key;
    decoded += String.fromCharCode(code);
  }
  return normalizeEmailCandidate(decoded);
}

/**
 * Handles `info (at) example (dot) com` style anti-scraping text.
 *
 * The separators must be bracketed or space-delimited. A looser pattern turns
 * ordinary prose into addresses — German "D-at-en.Diese" becomes "d@en.diese".
 */
const OBFUSCATED_PATTERNS = [
  /([a-z0-9._%+\-]+)\s*[([{]\s*(?:at|ät)\s*[)\]}]\s*([a-z0-9.\-]+?)\s*(?:[([{]\s*(?:dot|punkt)\s*[)\]}]|\.)\s*([a-z]{2,})/gi,
  /([a-z0-9._%+\-]+)\s+(?:at|ät)\s+([a-z0-9.\-]+?)\s+(?:dot|punkt)\s+([a-z]{2,})/gi,
];

export function decodeObfuscatedEmails(text: string): string[] {
  const found: string[] = [];

  for (const pattern of OBFUSCATED_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const candidate = normalizeEmailCandidate(
        `${match[1]}@${match[2]}.${match[3]}`,
      );
      if (candidate) found.push(candidate);
    }
  }

  return found;
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
  const path = href.toLowerCase();
  const haystack = `${path} ${text.toLowerCase()}`;
  let score = 0;

  for (const keyword of PRIORITY_KEYWORDS) {
    if (haystack.includes(keyword)) score += 10;
  }
  for (const pattern of LOW_VALUE_PATTERNS) {
    if (path.includes(pattern)) score -= 25;
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

  function record(candidate: string | null) {
    if (!candidate || emails.has(candidate)) return;
    emails.set(candidate, {
      email: candidate,
      sourceUrl: pageUrl,
      category: categorizeEmail(candidate),
    });
  }

  // Cloudflare-protected addresses, before scripts are stripped.
  $("[data-cfemail]").each((_, element) => {
    record(decodeCloudflareEmail($(element).attr("data-cfemail") ?? ""));
  });
  for (const match of html.matchAll(
    /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi,
  )) {
    record(decodeCloudflareEmail(match[1] ?? ""));
  }

  // JSON-LD and inline config blocks often carry the contact address.
  $('script[type="application/ld+json"], script[type="application/json"]').each(
    (_, element) => {
      const raw = $(element).text();
      for (const match of raw.matchAll(EMAIL_PATTERN)) {
        record(normalizeEmailCandidate(match[1] ?? match[0]));
      }
    },
  );

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

  // Tag boundaries become spaces, otherwise adjacent blocks glue together and
  // produce addresses like `info@shop.comNext paragraph`.
  const bodyText = decodeEntities($.html().replace(/<[^>]*>/g, " "));
  for (const match of bodyText.matchAll(EMAIL_PATTERN)) {
    record(normalizeEmailCandidate(match[1] ?? match[0]));
  }

  for (const candidate of decodeObfuscatedEmails(bodyText)) {
    record(candidate);
  }

  // Attributes outside <a>, such as data-email or onclick handlers.
  for (const match of html.matchAll(/mailto:([^\s"'<>]+)/gi)) {
    record(normalizeEmailCandidate(match[1] ?? ""));
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
