import { describe, expect, it } from "vitest";

import { classifyGmailMessage } from "@/features/gmail-cleaner/classify";
import type { GmailMessageMetadata } from "@/lib/google/gmail-mailbox";

function message(
  patch: Partial<GmailMessageMetadata> & {
    headers?: Record<string, string>;
    labelIds?: string[];
  },
): GmailMessageMetadata {
  return {
    id: patch.id ?? "msg-1",
    threadId: patch.threadId ?? "thread-1",
    labelIds: patch.labelIds ?? ["INBOX"],
    snippet: patch.snippet ?? "",
    sizeEstimate: patch.sizeEstimate ?? 1200,
    internalDate: patch.internalDate ?? String(Date.now()),
    headers: {
      from: "Ada <ada@example.com>",
      subject: "Hello",
      ...(patch.headers ?? {}),
    },
  };
}

describe("gmail cleaner classification", () => {
  it("protects drafts and sent mail", () => {
    expect(
      classifyGmailMessage(message({ labelIds: ["DRAFT"] })).primaryCategory,
    ).toBe("protected");
    expect(
      classifyGmailMessage(message({ labelIds: ["SENT"] })).suggestedAction,
    ).toBe("keep");
  });

  it("protects important, starred, and financial messages", () => {
    expect(
      classifyGmailMessage(
        message({
          labelIds: ["INBOX", "IMPORTANT"],
          headers: { subject: "Catching up" },
        }),
      ).protectionStatus,
    ).toBe("protected");
    expect(
      classifyGmailMessage(
        message({
          labelIds: ["INBOX", "STARRED"],
          headers: { subject: "Keep this" },
        }),
      ).suggestedAction,
    ).toBe("keep");

    expect(
      classifyGmailMessage(
        message({
          labelIds: ["INBOX"],
          headers: {
            from: "Billing <billing@vendor.com>",
            subject: "Invoice #4421 payment receipt",
          },
          snippet: "Your payment was received",
        }),
      ).primaryCategory,
    ).toBe("protected");
  });

  it("protects security and business enquiry signals", () => {
    expect(
      classifyGmailMessage(
        message({
          headers: { subject: "Password reset code" },
          snippet: "Your verification code is 123456",
        }),
      ).primaryCategory,
    ).toBe("protected");

    expect(
      classifyGmailMessage(
        message({
          headers: { subject: "Client enquiry about proposal" },
          snippet: "Can we schedule a meeting?",
        }),
      ).primaryCategory,
    ).toBe("protected");
  });

  it("does not trash solely because a message is old", () => {
    const yearAgo = String(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const result = classifyGmailMessage(
      message({
        labelIds: ["INBOX", "CATEGORY_PERSONAL"],
        internalDate: yearAgo,
        headers: {
          from: "Friend <friend@example.com>",
          subject: "Photos from last year",
        },
        snippet: "Hope you are well",
      }),
    );
    expect(result.suggestedAction).not.toBe("trash");
    expect(result.primaryCategory).not.toBe("old_conversations");
  });

  it("classifies promotions and newsletters from reliable signals", () => {
    expect(
      classifyGmailMessage(
        message({
          labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
          headers: {
            from: "Shop <deals@store.com>",
            subject: "Weekend sale",
            "list-unsubscribe": "<mailto:unsub@store.com>",
          },
        }),
      ).primaryCategory,
    ).toBe("promotions");

    expect(
      classifyGmailMessage(
        message({
          labelIds: ["INBOX"],
          headers: {
            from: "News <news@publisher.com>",
            subject: "Weekly newsletter digest",
            "list-unsubscribe": "<mailto:unsub@publisher.com>",
            "list-id": "<weekly.publisher.com>",
          },
        }),
      ).primaryCategory,
    ).toBe("newsletters");
  });

  it("classifies social updates and leaves weak promo language as needs review", () => {
    expect(
      classifyGmailMessage(
        message({
          labelIds: ["INBOX", "CATEGORY_SOCIAL"],
          headers: { from: "LinkedIn <updates@linkedin.com>", subject: "Views" },
        }),
      ).primaryCategory,
    ).toBe("social_updates");

    const weak = classifyGmailMessage(
      message({
        labelIds: ["INBOX", "CATEGORY_PERSONAL"],
        headers: {
          from: "Alex <alex@client.com>",
          subject: "Great deal on coffee next week?",
        },
        snippet: "Want to catch up",
      }),
    );
    expect(weak.suggestedAction).not.toBe("trash");
  });

  it("reports spam/trash separately without offering new cleanup", () => {
    const spam = classifyGmailMessage(
      message({ labelIds: ["SPAM"], headers: { subject: "Win money" } }),
    );
    expect(spam.primaryCategory).toBe("spam_like");
    expect(spam.suggestedAction).toBe("keep");

    const trash = classifyGmailMessage(
      message({ labelIds: ["TRASH"], headers: { subject: "Old promo" } }),
    );
    expect(trash.primaryCategory).toBe("already_trash");
    expect(trash.suggestedAction).toBe("keep");
  });

  it("marks uncertain bulk mail as needs review", () => {
    const result = classifyGmailMessage(
      message({
        labelIds: ["INBOX"],
        headers: {
          from: "System <noreply@tools.example>",
          subject: "Account note",
          precedence: "bulk",
          "list-unsubscribe": "<mailto:unsub@tools.example>",
        },
      }),
    );
    expect(["needs_review", "notifications", "marketing"]).toContain(
      result.primaryCategory,
    );
  });
});
