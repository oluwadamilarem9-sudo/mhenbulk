import * as cheerio from "cheerio";

import type { EmailFinderCategory } from "@/lib/supabase/database.types";
import {
  scoreEmailConfidence,
  type EmailFinderConfidence,
  type ExtractionMethod,
} from "@/features/email-finder/score";
import { canonicalizeCrawlUrl, sameHost } from "@/features/email-finder/url-security";

const EMAIL_PATTERN =
  /(?:mailto:)?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;

/** Contact-ish pages, including German and Shopify conventions. */
const PRIORITY_KEYWORDS = [
  "contact",
  "contact-us",
  "get-in-touch",
  "reach-us",
  "kontakt",
  "impressum",
  "imprint",
  "about",
  "about-us",
  "ueber-uns",
  "über-uns",
  "over-ons",
  "nosotros",
  "team",
  "our-team",
  "staff",
  "support",
  "help",
  "sales",
  "services",
  "customer-service",
  "company",
  "unternehmen",
  "leadership",
  "careers",
  "people",
  "legal",
  "policies",
  "privacy",
  "privacy-policy",
  "terms",
  "datenschutz",
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
  domain: string;
  sourceUrl: string;
  sourceUrls: string[];
  sourcePageTitle: string | null;
  category: EmailFinderCategory;
  confidence: EmailFinderConfidence;
  methods: ExtractionMethod[];
};

export type PageExtraction = {
  emails: ExtractedEmail[];
  links: Array<{ href: string; priority: number }>;
  pageTitle: string | null;
  javascriptHint: boolean;
};

type MutableHit = {
  email: string;
  sourceUrls: Set<string>;
  sourcePageTitle: string | null;
  methods: Set<ExtractionMethod>;
  category: EmailFinderCategory;
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
  if (/^[0-9a-f]{16,}$/.test(local)) return null;
  if (suffix.length > 12 && !KNOWN_TLDS.has(suffix)) return null;
  if (suffix.length > 2 && !KNOWN_TLDS.has(suffix) && !/^[a-z]{3,10}$/.test(suffix)) {
    return null;
  }

  return value;
}

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
 * Public obfuscation only. Separators must be bracketed, spaced, or explicit
 * `[at]` / `(at)` forms — never bare letters inside ordinary prose.
 */
const OBFUSCATED_PATTERNS = [
  /([a-z0-9._%+\-]+)\s*[([{]\s*(?:at|ät)\s*[)\]}]\s*([a-z0-9.\-]+?)\s*(?:[([{]\s*(?:dot|punkt)\s*[)\]}]|\.)\s*([a-z]{2,})/gi,
  /([a-z0-9._%+\-]+)\s+(?:at|ät)\s+([a-z0-9.\-]+?)\s+(?:dot|punkt)\s+([a-z]{2,})/gi,
  /([a-z0-9._%+\-]+)\s+@\s+([a-z0-9.\-]+?\.[a-z]{2,})/gi,
];

export function decodeObfuscatedEmails(text: string): string[] {
  const found: string[] = [];

  for (const pattern of OBFUSCATED_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const candidate =
        match.length >= 4
          ? normalizeEmailCandidate(`${match[1]}@${match[2]}.${match[3]}`)
          : normalizeEmailCandidate(`${match[1]}@${match[2]}`);
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

function finalizeHit(hit: MutableHit): ExtractedEmail {
  const methods = [...hit.methods];
  const sourceUrls = [...hit.sourceUrls];
  const confidence = scoreEmailConfidence({
    email: hit.email,
    category: hit.category,
    sourceUrls,
    methods,
  });

  return {
    email: hit.email,
    domain: hit.email.split("@")[1] ?? "",
    sourceUrl: sourceUrls[0] ?? "",
    sourceUrls,
    sourcePageTitle: hit.sourcePageTitle,
    category: hit.category,
    confidence,
    methods,
  };
}

export function extractEmailsAndLinks(
  html: string,
  pageUrl: string,
  rootHostname: string,
): PageExtraction {
  const $ = cheerio.load(html);
  const hits = new Map<string, MutableHit>();
  const links = new Map<string, number>();
  const pageTitle = ($("title").first().text() || "").trim() || null;

  function record(candidate: string | null, method: ExtractionMethod) {
    if (!candidate) return;
    const existing = hits.get(candidate);
    if (existing) {
      existing.sourceUrls.add(pageUrl);
      existing.methods.add(method);
      if (!existing.sourcePageTitle && pageTitle) {
        existing.sourcePageTitle = pageTitle;
      }
      return;
    }
    hits.set(candidate, {
      email: candidate,
      sourceUrls: new Set([pageUrl]),
      sourcePageTitle: pageTitle,
      methods: new Set([method]),
      category: categorizeEmail(candidate),
    });
  }

  // Cloudflare-protected addresses, before scripts are stripped.
  $("[data-cfemail]").each((_, element) => {
    record(decodeCloudflareEmail($(element).attr("data-cfemail") ?? ""), "cloudflare");
  });
  for (const match of html.matchAll(
    /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi,
  )) {
    record(decodeCloudflareEmail(match[1] ?? ""), "cloudflare");
  }

  // JSON-LD and inline config blocks often carry the contact address.
  $('script[type="application/ld+json"], script[type="application/json"]').each(
    (_, element) => {
      const raw = $(element).text();
      for (const match of raw.matchAll(EMAIL_PATTERN)) {
        record(normalizeEmailCandidate(match[1] ?? match[0]), "json_ld");
      }
    },
  );

  // Public meta tags (author / description / og) sometimes expose a contact.
  $("meta[content]").each((_, element) => {
    const content = $(element).attr("content") ?? "";
    for (const match of content.matchAll(EMAIL_PATTERN)) {
      record(normalizeEmailCandidate(match[1] ?? match[0]), "meta");
    }
  });

  $("script, style, noscript").remove();

  $("a[href]").each((_, element) => {
    const href = ($(element).attr("href") || "").trim();
    const text = $(element).text();
    if (/^mailto:/i.test(href)) {
      record(normalizeEmailCandidate(href), "mailto");
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

  // Tag boundaries become spaces so adjacent blocks do not glue into false emails.
  const bodyText = decodeEntities($.html().replace(/<[^>]*>/g, " "));
  for (const match of bodyText.matchAll(EMAIL_PATTERN)) {
    record(normalizeEmailCandidate(match[1] ?? match[0]), "visible_text");
  }

  for (const candidate of decodeObfuscatedEmails(bodyText)) {
    record(candidate, "obfuscated");
  }

  // Attributes outside <a>, such as data-email or onclick handlers.
  for (const match of html.matchAll(/mailto:([^\s"'<>]+)/gi)) {
    record(normalizeEmailCandidate(match[1] ?? ""), "mailto");
  }
  for (const match of html.matchAll(
    /(?:data-email|data-mail|data-contact)=["']([^"']+)["']/gi,
  )) {
    record(normalizeEmailCandidate(match[1] ?? ""), "raw_html");
  }
  for (const match of html.matchAll(EMAIL_PATTERN)) {
    record(normalizeEmailCandidate(match[1] ?? match[0]), "raw_html");
  }

  const javascriptHint =
    hits.size === 0 &&
    (/<script[\s>]/i.test(html) || /__NEXT_DATA__|ng-app|data-reactroot/i.test(html));

  return {
    emails: [...hits.values()].map(finalizeHit),
    links: [...links.entries()]
      .map(([href, priority]) => ({ href, priority }))
      .sort((a, b) => b.priority - a.priority),
    pageTitle,
    javascriptHint,
  };
}

export function dedupeEmails(emails: ExtractedEmail[]): ExtractedEmail[] {
  const map = new Map<string, MutableHit>();

  for (const item of emails) {
    const existing = map.get(item.email);
    if (!existing) {
      map.set(item.email, {
        email: item.email,
        sourceUrls: new Set(item.sourceUrls.length ? item.sourceUrls : [item.sourceUrl]),
        sourcePageTitle: item.sourcePageTitle,
        methods: new Set(item.methods),
        category: item.category,
      });
      continue;
    }
    for (const url of item.sourceUrls.length ? item.sourceUrls : [item.sourceUrl]) {
      if (url) existing.sourceUrls.add(url);
    }
    for (const method of item.methods) existing.methods.add(method);
    if (!existing.sourcePageTitle && item.sourcePageTitle) {
      existing.sourcePageTitle = item.sourcePageTitle;
    }
  }

  return [...map.values()]
    .map(finalizeHit)
    .sort((a, b) => a.email.localeCompare(b.email));
}
