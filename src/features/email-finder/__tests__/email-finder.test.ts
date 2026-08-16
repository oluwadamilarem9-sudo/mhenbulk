import { describe, expect, it } from "vitest";

import {
  isBlockedIpAddress,
  canonicalizeCrawlUrl,
  sameHost,
} from "@/features/email-finder/url-security";
import {
  categorizeEmail,
  decodeObfuscatedEmails,
  dedupeEmails,
  extractEmailsAndLinks,
  normalizeEmailCandidate,
} from "@/features/email-finder/extract";
import { isPathAllowed, parseRobotsTxt } from "@/features/email-finder/robots";
import { isOwnerGradeEmail } from "@/features/email-finder/score";
import { parseSitemapUrls } from "@/features/email-finder/sitemap";

describe("url-security", () => {
  it("blocks private and metadata addresses", () => {
    expect(isBlockedIpAddress("127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("10.0.0.5")).toBe(true);
    expect(isBlockedIpAddress("192.168.1.10")).toBe(true);
    expect(isBlockedIpAddress("172.16.0.1")).toBe(true);
    expect(isBlockedIpAddress("169.254.169.254")).toBe(true);
    expect(isBlockedIpAddress("::1")).toBe(true);
    expect(isBlockedIpAddress("fc00::1")).toBe(true);
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
  });

  it("canonicalizes crawl urls and rejects dangerous schemes", () => {
    expect(canonicalizeCrawlUrl("/team", "https://example.com")).toBe(
      "https://example.com/team",
    );
    expect(canonicalizeCrawlUrl("javascript:alert(1)", "https://example.com")).toBeNull();
    expect(sameHost("Example.com", "example.com.")).toBe(true);
    expect(sameHost("www.example.com", "example.com")).toBe(true);
  });
});

describe("email extraction", () => {
  it("normalizes and validates emails", () => {
    expect(normalizeEmailCandidate("HELLO@ACME-SHOP.COM")).toBe("hello@acme-shop.com");
    expect(normalizeEmailCandidate("mailto:sales@acme-shop.co.uk?subject=Hi")).toBe(
      "sales@acme-shop.co.uk",
    );
    expect(normalizeEmailCandidate("<john.smith@acme-shop.com>;")).toBe(
      "john.smith@acme-shop.com",
    );
    expect(normalizeEmailCandidate("not-an-email")).toBeNull();
  });

  it("categorizes generic and business addresses", () => {
    expect(categorizeEmail("noreply@example.com")).toBe("generic");
    expect(categorizeEmail("sales@example.com")).toBe("business");
    expect(categorizeEmail("john.smith@example.com")).toBe("personal");
  });

  it("extracts mailto links and visible text emails", () => {
    const html = `
      <html><body>
        <a href="mailto:Hello@Acme-Shop.com">Email us</a>
        <p>Reach sales@acme-shop.com or support@acme-shop.com today.</p>
        <a href="/team">Team</a>
        <a href="https://other.com/contact">External</a>
      </body></html>
    `;
    const extracted = extractEmailsAndLinks(
      html,
      "https://acme-shop.com/",
      "acme-shop.com",
    );
    expect(extracted.emails.map((item) => item.email).sort()).toEqual([
      "hello@acme-shop.com",
      "sales@acme-shop.com",
      "support@acme-shop.com",
    ]);
    expect(extracted.emails.every((item) => item.confidence)).toBe(true);
    expect(extracted.links.some((link) => link.href.includes("/team"))).toBe(true);
    expect(extracted.links.every((link) => link.href.includes("acme-shop.com"))).toBe(
      true,
    );
  });

  it("rejects assets, placeholders, and prose glued to an address", () => {
    expect(normalizeEmailCandidate("logo@2x.png")).toBeNull();
    expect(normalizeEmailCandidate("someone@example.com")).toBeNull();
    expect(normalizeEmailCandidate("hi@sentry.io")).toBeNull();
    expect(
      normalizeEmailCandidate("info@shop.comverbraucherstreitbeilegung"),
    ).toBeNull();
    expect(normalizeEmailCandidate("info@shop.de")).toBe("info@shop.de");
  });

  it("decodes Cloudflare-protected addresses", () => {
    const html =
      '<a class="__cf_email__" data-cfemail="630a0d050c2302000e064e100b0c134d0706">[email&#160;protected]</a>';
    const extracted = extractEmailsAndLinks(html, "https://acme-shop.de/", "acme-shop.de");
    expect(extracted.emails.map((item) => item.email)).toEqual(["info@acme-shop.de"]);
  });

  it("decodes bracketed obfuscation without matching ordinary prose", () => {
    expect(decodeObfuscatedEmails("info (at) acme-shop (dot) com")).toEqual([
      "info@acme-shop.com",
    ]);
    expect(decodeObfuscatedEmails("kontakt at acme-shop dot de")).toEqual([
      "kontakt@acme-shop.de",
    ]);
    expect(decodeObfuscatedEmails("hello @ acme-shop.com")).toEqual([
      "hello@acme-shop.com",
    ]);
    // German prose: "Daten.Diese" must not become "d@en.diese".
    expect(decodeObfuscatedEmails("Wir speichern Daten.Diese Angaben")).toEqual([]);
  });

  it("keeps adjacent blocks apart when reading page text", () => {
    const html = "<body><p>info@shop.de</p><p>Bei Fragen</p></body>";
    const extracted = extractEmailsAndLinks(html, "https://shop.de/", "shop.de");
    expect(extracted.emails.map((item) => item.email)).toEqual(["info@shop.de"]);
  });

  it("reads public meta and JSON-LD addresses", () => {
    const html = `
      <html><head>
        <meta name="author" content="owner@acme-shop.com" />
        <script type="application/ld+json">
          {"email":"press@acme-shop.com"}
        </script>
      </head><body></body></html>
    `;
    const extracted = extractEmailsAndLinks(html, "https://acme-shop.com/", "acme-shop.com");
    expect(extracted.emails.map((item) => item.email).sort()).toEqual([
      "owner@acme-shop.com",
      "press@acme-shop.com",
    ]);
  });

  it("prefers contact pages over cart and product links", () => {
    const html = `
      <a href="/pages/contact">Contact</a>
      <a href="/cart">Cart</a>
      <a href="/products/shirt">Shirt</a>
    `;
    const extracted = extractEmailsAndLinks(html, "https://shop.de/", "shop.de");
    expect(extracted.links[0].href).toContain("/pages/contact");
    expect(extracted.links.at(-1)?.href).toMatch(/\/cart|\/products\/shirt/);
  });

  it("deduplicates emails and keeps every source URL", () => {
    const rows = dedupeEmails([
      {
        email: "a@acme-shop.com",
        domain: "acme-shop.com",
        sourceUrl: "https://acme-shop.com/",
        sourceUrls: ["https://acme-shop.com/"],
        sourcePageTitle: "Home",
        category: "business",
        confidence: "medium",
        methods: ["visible_text"],
      },
      {
        email: "a@acme-shop.com",
        domain: "acme-shop.com",
        sourceUrl: "https://acme-shop.com/contact",
        sourceUrls: ["https://acme-shop.com/contact"],
        sourcePageTitle: "Contact",
        category: "business",
        confidence: "medium",
        methods: ["mailto"],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceUrls).toEqual([
      "https://acme-shop.com/",
      "https://acme-shop.com/contact",
    ]);
    expect(rows[0].methods.sort()).toEqual(["mailto", "visible_text"]);
  });
});

describe("scoring", () => {
  it("marks role inboxes as non-owner-grade", () => {
    expect(isOwnerGradeEmail("john.smith@acme-shop.com", "personal")).toBe(true);
    expect(isOwnerGradeEmail("info@acme-shop.com", "business")).toBe(false);
    expect(isOwnerGradeEmail("noreply@acme-shop.com", "generic")).toBe(false);
  });
});

describe("sitemap", () => {
  it("keeps only same-host priority URLs", () => {
    const xml = `
      <urlset>
        <url><loc>https://acme-shop.com/contact</loc></url>
        <url><loc>https://acme-shop.com/products/shirt</loc></url>
        <url><loc>https://other.com/team</loc></url>
      </urlset>
    `;
    const urls = parseSitemapUrls(xml, "acme-shop.com", "https://acme-shop.com");
    expect(urls.map((item) => item.href)).toEqual(["https://acme-shop.com/contact"]);
  });
});

describe("robots", () => {
  it("respects disallow rules for matching user agents", () => {
    const rules = parseRobotsTxt(
      `
User-agent: *
Disallow: /private
Allow: /private/public
`.trim(),
      "MhenbulkEmailFinder/1.0",
    );
    expect(isPathAllowed(rules, "/private", "")).toBe(false);
    expect(isPathAllowed(rules, "/private/public", "")).toBe(true);
    expect(isPathAllowed(rules, "/contact", "")).toBe(true);
  });

  it("does not match User-agent tokens as substrings of the full UA", () => {
    const text = `
User-agent: app
Disallow: /

User-agent: MhenbulkEmailFinder
Disallow: /admin
Allow: /
`.trim();
    const rules = parseRobotsTxt(
      text,
      "MhenbulkEmailFinder/1.0 (+https://mhenbulk.vercel.app)",
    );
    expect(isPathAllowed(rules, "/", "")).toBe(true);
    expect(isPathAllowed(rules, "/admin", "")).toBe(false);
  });
});
