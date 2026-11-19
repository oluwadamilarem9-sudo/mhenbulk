import { describe, expect, it } from "vitest";

import { classifyGmailMessage } from "@/features/gmail-cleaner/classify";
import { applyDefaultSelection } from "@/features/gmail-cleaner/selection";
import {
  aggregateGmailCleanerStats,
  displayCategoryForStats,
  type StatsMessage,
} from "@/features/gmail-cleaner/stats";
import type { GmailMessageMetadata } from "@/lib/google/gmail-mailbox";

function meta(
  patch: Partial<GmailMessageMetadata> & { labelIds?: string[] },
): GmailMessageMetadata {
  return {
    id: patch.id ?? "msg",
    threadId: patch.threadId ?? "thread",
    labelIds: patch.labelIds ?? ["INBOX"],
    snippet: patch.snippet ?? "",
    sizeEstimate: patch.sizeEstimate ?? 1000,
    internalDate: patch.internalDate ?? String(Date.now()),
    headers: {
      from: "Ada <ada@example.com>",
      subject: "Hello",
      ...(patch.headers ?? {}),
    },
  };
}

function fromClassification(
  id: string,
  message: GmailMessageMetadata,
  selected = false,
): StatsMessage {
  const classified = classifyGmailMessage(message);
  const labels = message.labelIds ?? [];
  return {
    id,
    gmailMessageId: id,
    protectionStatus: classified.protectionStatus,
    suggestedAction: classified.suggestedAction,
    selected,
    isSpam: labels.includes("SPAM"),
    isTrash: labels.includes("TRASH"),
    isDraft: labels.includes("DRAFT"),
    isSent: labels.includes("SENT"),
    labelIds: labels,
    primaryCategory: classified.primaryCategory,
  };
}

/**
 * Screenshot scenario:
 * 214 scanned, 152 protected, 110 already in Trash, 1 spam,
 * 4 notifications (manual review), and legacy needs_review rows that are trash.
 */
function buildScreenshotScenario(): StatsMessage[] {
  const messages: StatsMessage[] = [];

  // 99 protected inbox messages (not in trash)
  for (let i = 0; i < 99; i += 1) {
    messages.push(
      fromClassification(
        `prot-${i}`,
        meta({
          id: `prot-${i}`,
          labelIds: ["INBOX", "IMPORTANT"],
          headers: { subject: "Client thread" },
        }),
      ),
    );
  }

  // 53 protected Sent messages that also sit in Trash (SENT checked before TRASH).
  for (let i = 0; i < 53; i += 1) {
    messages.push(
      fromClassification(
        `sent-trash-${i}`,
        meta({
          id: `sent-trash-${i}`,
          labelIds: ["SENT", "TRASH"],
          headers: { subject: "Sent copy" },
        }),
      ),
    );
  }

  // 57 already-in-Trash messages (legacy stored category may be needs_review).
  for (let i = 0; i < 57; i += 1) {
    const row = fromClassification(
      `trash-${i}`,
      meta({
        id: `trash-${i}`,
        labelIds: ["TRASH"],
        headers: { subject: "Old promo in trash" },
      }),
    );
    // Simulate pre-fix DB rows that stored trash under needs_review.
    messages.push({
      ...row,
      primaryCategory: "needs_review",
      suggestedAction: "keep",
      selected: false,
    });
  }

  // 1 spam
  messages.push(
    fromClassification(
      "spam-1",
      meta({
        id: "spam-1",
        labelIds: ["SPAM"],
        headers: { subject: "Win money" },
      }),
    ),
  );

  // 4 notifications → suggested review (manual review card)
  for (let i = 0; i < 4; i += 1) {
    messages.push(
      fromClassification(
        `notify-${i}`,
        meta({
          id: `notify-${i}`,
          labelIds: ["INBOX", "CATEGORY_UPDATES"],
          headers: {
            from: "Alerts <noreply@service.com>",
            subject: "Notification update",
          },
        }),
      ),
    );
  }

  expect(messages).toHaveLength(214);
  return applyDefaultSelection(messages) as StatsMessage[];
}

describe("gmail cleaner dashboard vs category stats", () => {
  it("explains the screenshot figures under real classification rules", () => {
    const messages = buildScreenshotScenario();
    const { cards, categories, categorySum } =
      aggregateGmailCleanerStats(messages);

    expect(cards.scanned).toBe(214);
    expect(cards.protected).toBe(152); // 99 important + 53 sent/trash
    expect(cards.alreadyInTrash).toBe(110); // 53 sent/trash + 57 trash
    expect(cards.alreadyInSpam).toBe(1);
    expect(cards.manualReview).toBe(4); // notifications only
    expect(cards.potentialClutter).toBe(0);
    expect(cards.selectedEligible).toBe(0);

    // Category tiles are mutually exclusive and sum to scanned.
    expect(categorySum).toBe(214);
    expect(categories.protected).toBe(152);
    expect(categories.notifications).toBe(4);
    expect(categories.spam_like).toBe(1);
    // Legacy needs_review + is_trash remap into already_trash for category tiles.
    expect(categories.already_trash).toBe(57);
    expect(categories.needs_review).toBe(0);

    // Manual review card (suggested_action=review) is not the same metric as
    // the uncertain classification category tile.
    expect(cards.manualReview).toBe(4);
    expect(categories.needs_review).toBe(0);

    // Trash card can exceed already_trash category because Sent+Trash is Protected.
    expect(cards.alreadyInTrash).toBeGreaterThan(categories.already_trash);
  });

  it("does not double-count multi-label messages in scanned or category totals", () => {
    const message = fromClassification(
      "multi",
      meta({
        id: "multi",
        labelIds: [
          "INBOX",
          "CATEGORY_PROMOTIONS",
          "CATEGORY_PROMOTIONS",
          "UNREAD",
          "UNREAD",
        ],
        headers: {
          from: "Shop <deals@store.com>",
          subject: "Sale",
          "list-unsubscribe": "<mailto:unsub@store.com>",
        },
        snippet: "Limited time sale",
      }),
    );
    const { cards, categorySum } = aggregateGmailCleanerStats([message]);
    expect(cards.scanned).toBe(1);
    expect(categorySum).toBe(1);
    expect(cards.potentialClutter).toBe(1);
  });

  it("never auto-selects protected, spam, trash, or manual-review messages", () => {
    const messages = buildScreenshotScenario();
    expect(messages.every((m) => !m.selected)).toBe(true);
    expect(
      messages.filter((m) => m.protectionStatus === "protected" && m.selected),
    ).toHaveLength(0);
    expect(messages.filter((m) => m.isSpam && m.selected)).toHaveLength(0);
    expect(messages.filter((m) => m.isTrash && m.selected)).toHaveLength(0);
    expect(
      messages.filter((m) => m.suggestedAction === "review" && m.selected),
    ).toHaveLength(0);
  });

  it("maps already-in-trash away from the uncertain needs_review category", () => {
    expect(
      displayCategoryForStats({
        primaryCategory: "needs_review",
        protectionStatus: "none",
        suggestedAction: "keep",
        selected: false,
        isSpam: false,
        isTrash: true,
        isDraft: false,
        isSent: false,
        labelIds: ["TRASH"],
      }),
    ).toBe("already_trash");
  });

  it("classifies fresh trash messages as already_trash", () => {
    const trash = classifyGmailMessage(
      meta({ labelIds: ["TRASH"], headers: { subject: "Gone" } }),
    );
    expect(trash.primaryCategory).toBe("already_trash");
    expect(trash.suggestedAction).toBe("keep");
  });
});
