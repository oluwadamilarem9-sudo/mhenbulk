import { describe, expect, it } from "vitest";

import {
  cleanOneRecord,
  markDuplicates,
  parsePastedEmails,
} from "@/features/email-cleaner/utils";

describe("email cleaner utilities", () => {
  it("marks valid email as VALID", () => {
    const row = cleanOneRecord({
      rowIndex: 1,
      originalEmail: "john@example.com",
      extra: {},
    });
    expect(row.status).toBe("VALID");
    expect(row.cleanEmail).toBe("john@example.com");
  });

  it("normalizes uppercase and spaces as CORRECTED", () => {
    const row = cleanOneRecord({
      rowIndex: 1,
      originalEmail: " JOHN @ EXAMPLE.COM ",
      extra: {},
    });
    expect(row.status).toBe("CORRECTED");
    expect(row.cleanEmail).toBe("john@example.com");
  });

  it("flags missing at-sign as INVALID", () => {
    const row = cleanOneRecord({
      rowIndex: 1,
      originalEmail: "johnexample.com",
      extra: {},
    });
    expect(row.status).toBe("INVALID");
  });

  it("flags domain typo as REVIEW_REQUIRED with suggestion", () => {
    const row = cleanOneRecord({
      rowIndex: 1,
      originalEmail: "john@gmial.com",
      extra: {},
    });
    expect(row.status).toBe("REVIEW_REQUIRED");
    expect(row.suggestedCorrection).toBe("john@gmail.com");
  });

  it("marks duplicate records after normalization", () => {
    const rows = [
      cleanOneRecord({ rowIndex: 1, originalEmail: "john@example.com", extra: {} }),
      cleanOneRecord({ rowIndex: 2, originalEmail: "JOHN@EXAMPLE.COM", extra: {} }),
    ];
    const marked = markDuplicates(rows, "first");
    expect(marked[0].status).not.toBe("DUPLICATE");
    expect(marked[1].status).toBe("DUPLICATE");
  });

  it("parses comma, semicolon and newline separated values", () => {
    const records = parsePastedEmails("a@example.com,b@example.com;c@example.com\nd@example.com");
    expect(records).toHaveLength(4);
  });
});

