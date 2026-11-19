import { describe, expect, it } from "vitest";

import { evaluateLiveTrashProtection } from "@/features/gmail-cleaner/cleanup-guard";
import type { GmailMessageMetadata } from "@/lib/google/gmail-mailbox";
import { GmailApiError } from "@/lib/google/gmail-mailbox";

function metadata(
  patch: Partial<GmailMessageMetadata> & { labelIds?: string[] },
): GmailMessageMetadata {
  return {
    id: patch.id ?? "msg-1",
    threadId: patch.threadId ?? "thread-1",
    labelIds: patch.labelIds ?? ["INBOX", "CATEGORY_PROMOTIONS"],
    snippet: patch.snippet ?? "Limited time sale",
    sizeEstimate: patch.sizeEstimate ?? 1200,
    internalDate: patch.internalDate ?? String(Date.now()),
    headers: {
      from: "Shop <deals@store.com>",
      subject: "Weekend sale",
      "list-unsubscribe": "<mailto:unsub@store.com>",
      ...(patch.headers ?? {}),
    },
  };
}

describe("evaluateLiveTrashProtection", () => {
  it("allows a still-eligible promotional message", () => {
    const result = evaluateLiveTrashProtection(metadata({}));
    expect(result).toEqual({ ok: true });
  });

  it("skips a message that became starred after the scan", () => {
    const result = evaluateLiveTrashProtection(
      metadata({
        labelIds: ["INBOX", "CATEGORY_PROMOTIONS", "STARRED"],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("skipped");
      expect(result.reason).toMatch(/starred after the scan/i);
      expect(result.wasAlreadyTrash).toBe(false);
    }
  });

  it("skips a message that became important after the scan", () => {
    const result = evaluateLiveTrashProtection(
      metadata({
        labelIds: ["INBOX", "CATEGORY_PROMOTIONS", "IMPORTANT"],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("skipped");
      expect(result.reason).toMatch(/important after the scan/i);
    }
  });

  it("skips newly protected financial content found on live recheck", () => {
    const result = evaluateLiveTrashProtection(
      metadata({
        labelIds: ["INBOX"],
        headers: {
          from: "Billing <billing@vendor.com>",
          subject: "Invoice payment receipt",
        },
        snippet: "Your payment was received",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/protected by live recheck/i);
    }
  });

  it("never trashes when latest metadata cannot be verified", () => {
    const result = evaluateLiveTrashProtection(
      null,
      new GmailApiError("rate limited", "rate_limited", 429),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("skipped");
      expect(result.reason).toMatch(/could not verify latest protection/i);
    }
  });

  it("skips missing messages safely", () => {
    const result = evaluateLiveTrashProtection(
      null,
      new GmailApiError("gone", "not_found", 404),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/no longer available/i);
    }
  });
});
