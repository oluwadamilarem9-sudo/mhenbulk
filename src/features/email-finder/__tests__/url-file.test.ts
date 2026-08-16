import { describe, expect, it } from "vitest";

import {
  normalizeWebsiteCandidate,
  parseWebsiteUrlFile,
} from "@/features/email-finder/url-file";

describe("normalizeWebsiteCandidate", () => {
  it("adds https to bare domains", () => {
    expect(normalizeWebsiteCandidate("handballtag.de")?.url).toBe(
      "https://handballtag.de/",
    );
  });

  it("keeps paths and drops fragments", () => {
    const result = normalizeWebsiteCandidate("https://example.com/contact#team");
    expect(result?.url).toBe("https://example.com/contact");
  });

  it("treats www and apex as the same website", () => {
    const bare = normalizeWebsiteCandidate("example.com");
    const www = normalizeWebsiteCandidate("https://www.example.com/");
    expect(bare?.key).toBe(www?.key);
  });

  it("rejects emails, dates, other schemes, and filenames", () => {
    expect(normalizeWebsiteCandidate("hello@example.com")).toBeNull();
    expect(normalizeWebsiteCandidate("8/7/2026")).toBeNull();
    expect(normalizeWebsiteCandidate("mailto:hi@example.com")).toBeNull();
    expect(normalizeWebsiteCandidate("ftp://example.com")).toBeNull();
    expect(normalizeWebsiteCandidate("report.pdf")).toBeNull();
    expect(normalizeWebsiteCandidate("")).toBeNull();
  });

  it("rejects credentials in the URL", () => {
    expect(normalizeWebsiteCandidate("https://user:pass@example.com")).toBeNull();
  });
});

describe("parseWebsiteUrlFile", () => {
  it("reads a two-column export with a header row", () => {
    const csv = [
      "created,domain_url",
      "8/7/2026,https://www.vaupel-gerbstedt.de",
      "8/7/2026,https://handballtag.de",
    ].join("\n");

    const result = parseWebsiteUrlFile(csv, "Germany 09-08.csv");

    expect(result.error).toBeUndefined();
    expect(result.rows.map((row) => row.domain)).toEqual([
      "www.vaupel-gerbstedt.de",
      "handballtag.de",
    ]);
    expect(result.skipped).toBe(0);
  });

  it("strips a byte order mark", () => {
    const result = parseWebsiteUrlFile(
      "\uFEFFcreated,domain_url\n8/7/2026,https://example.com",
      "export.csv",
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].domain).toBe("example.com");
  });

  it("counts duplicates once", () => {
    const result = parseWebsiteUrlFile(
      ["https://example.com", "https://www.example.com/", "example.com"].join("\n"),
      "list.txt",
    );

    expect(result.rows).toHaveLength(1);
    expect(result.duplicates).toBe(2);
  });

  it("reports a clear error when the file has no websites", () => {
    const result = parseWebsiteUrlFile("first_name,email\nAda,ada@example.com", "c.csv");

    expect(result.rows).toHaveLength(0);
    expect(result.error).toContain("couldn't find any website addresses");
  });
});
