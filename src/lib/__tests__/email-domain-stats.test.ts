import { describe, expect, it } from "vitest";

import {
  buildDomainBreakdown,
  classifyEmailProvider,
  extractEmailDomain,
} from "@/lib/email-domain-stats";

describe("email-domain-stats", () => {
  it("normalizes domains from mixed-case emails", () => {
    expect(extractEmailDomain("JOHN@GMAIL.COM")).toBe("gmail.com");
    expect(extractEmailDomain("bad")).toBe("unknown");
  });

  it("classifies personal providers vs business domains", () => {
    expect(classifyEmailProvider("gmail.com")).toBe("Personal Provider");
    expect(classifyEmailProvider("acme-shop.com")).toBe("Business Domain");
    expect(classifyEmailProvider("")).toBe("Unknown");
  });

  it("builds dynamic domain totals including other bucket", () => {
    const emails = [
      ...Array.from({ length: 300 }, () => "a@gmail.com"),
      ...Array.from({ length: 200 }, () => "b@yahoo.com"),
      ...Array.from({ length: 100 }, () => "c@outlook.com"),
      ...Array.from({ length: 100 }, () => "d@hotmail.com"),
      ...Array.from({ length: 200 }, () => "e@company.com"),
      ...Array.from({ length: 100 }, () => "f@custom.io"),
    ];

    const breakdown = buildDomainBreakdown(emails, 5);
    expect(breakdown.total).toBe(1000);

    const byDomain = Object.fromEntries(
      breakdown.entries
        .filter((entry) => entry.domain !== "other")
        .map((entry) => [entry.domain, entry.count]),
    );
    expect(byDomain["gmail.com"]).toBe(300);
    expect(byDomain["yahoo.com"]).toBe(200);
    expect(byDomain["company.com"]).toBe(200);
    expect(breakdown.otherCount).toBe(100);
  });
});
