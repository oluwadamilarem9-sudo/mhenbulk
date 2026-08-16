import { describe, expect, it } from "vitest";

import {
  isBlockedIpAddress,
  canonicalizeCrawlUrl,
  sameHost,
} from "@/features/email-finder/url-security";
import {
  categorizeEmail,
  dedupeEmails,
  extractEmailsAndLinks,
  normalizeEmailCandidate,
} from "@/features/email-finder/extract";
import { isPathAllowed, parseRobotsTxt } from "@/features/email-finder/robots";

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
  });
});

describe("email extraction", () => {
  it("normalizes and validates emails", () => {
    expect(normalizeEmailCandidate("HELLO@EXAMPLE.COM")).toBe("hello@example.com");
    expect(normalizeEmailCandidate("mailto:sales@example.co.uk?subject=Hi")).toBe(
      "sales@example.co.uk",
    );
    expect(normalizeEmailCandidate("<john.smith@example.com>;")).toBe(
      "john.smith@example.com",
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
        <a href="mailto:Hello@Example.com">Email us</a>
        <p>Reach sales@example.com or support@example.com today.</p>
        <a href="/team">Team</a>
        <a href="https://other.com/contact">External</a>
      </body></html>
    `;
    const extracted = extractEmailsAndLinks(html, "https://example.com/", "example.com");
    expect(extracted.emails.map((item) => item.email).sort()).toEqual([
      "hello@example.com",
      "sales@example.com",
      "support@example.com",
    ]);
    expect(extracted.links.some((link) => link.href.includes("/team"))).toBe(true);
    expect(extracted.links.every((link) => link.href.includes("example.com"))).toBe(true);
  });

  it("deduplicates emails", () => {
    const rows = dedupeEmails([
      {
        email: "a@example.com",
        sourceUrl: "https://example.com/",
        category: "business",
      },
      {
        email: "a@example.com",
        sourceUrl: "https://example.com/contact",
        category: "business",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceUrl).toContain("/contact");
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
});
