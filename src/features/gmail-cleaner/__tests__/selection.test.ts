import { describe, expect, it } from "vitest";

import {
  applyDefaultSelection,
  isDefaultCleanupCandidate,
  isEligibleSelected,
  isManuallySelectable,
  isSelectionBlocked,
  selectCategoryCandidates,
  summarizeScanSelectionStats,
  toggleManualSelection,
  type SelectionMessageLike,
} from "@/features/gmail-cleaner/selection";

type TestRow = SelectionMessageLike & {
  id: string;
  primaryCategory: string;
};

function row(
  patch: Partial<TestRow> & {
    id: string;
  },
): TestRow {
  return {
    id: patch.id,
    gmailMessageId: patch.gmailMessageId ?? patch.id,
    protectionStatus: patch.protectionStatus ?? "none",
    suggestedAction: patch.suggestedAction ?? "keep",
    selected: patch.selected ?? false,
    isSpam: patch.isSpam ?? false,
    isTrash: patch.isTrash ?? false,
    isDraft: patch.isDraft ?? false,
    isSent: patch.isSent ?? false,
    labelIds: patch.labelIds ?? ["INBOX"],
    primaryCategory: patch.primaryCategory ?? "needs_review",
  };
}

function categoryOf(message: SelectionMessageLike): string {
  return (message as TestRow).primaryCategory;
}

/** Simulate a 214-message scan with 2 clutter candidates. */
function buildScan214(): TestRow[] {
  const messages: TestRow[] = [];

  for (let i = 0; i < 154; i += 1) {
    messages.push(
      row({
        id: `prot-${i}`,
        protectionStatus: "protected",
        suggestedAction: "keep",
        primaryCategory: "protected",
        labelIds: i % 2 === 0 ? ["INBOX", "IMPORTANT"] : ["INBOX", "STARRED"],
      }),
    );
  }

  messages.push(
    row({
      id: "spam-1",
      suggestedAction: "keep",
      isSpam: true,
      primaryCategory: "spam_like",
      labelIds: ["SPAM"],
    }),
  );

  messages.push(
    row({
      id: "clutter-1",
      suggestedAction: "trash",
      primaryCategory: "promotions",
      labelIds: ["INBOX", "CATEGORY_PROMOTIONS"],
    }),
    row({
      id: "clutter-2",
      suggestedAction: "trash",
      primaryCategory: "social_updates",
      labelIds: ["INBOX", "CATEGORY_SOCIAL"],
    }),
  );

  // Remaining uncertain / review messages (214 - 154 - 1 - 2 = 57).
  for (let i = 0; i < 57; i += 1) {
    messages.push(
      row({
        id: `review-${i}`,
        suggestedAction: "review",
        primaryCategory: i < 40 ? "notifications" : "needs_review",
        labelIds: ["INBOX", "CATEGORY_UPDATES", "UNREAD"],
      }),
    );
  }

  expect(messages).toHaveLength(214);
  return applyDefaultSelection(messages).map((message, index) => ({
    ...message,
    id: messages[index].id,
    primaryCategory: messages[index].primaryCategory,
  }));
}

describe("gmail cleaner selection and stats", () => {
  it("selects only 2 cleanup candidates out of 214 scanned emails", () => {
    const messages = buildScan214();
    const stats = summarizeScanSelectionStats(messages);

    expect(stats.total).toBe(214);
    expect(stats.clutter).toBe(2);
    expect(stats.protected).toBe(154);
    expect(stats.spam).toBe(1);
    expect(stats.trash).toBe(0);
    expect(stats.selectedEligible).toBe(2);
    expect(messages.filter((m) => m.selected).map((m) => m.id)).toEqual([
      "clutter-1",
      "clutter-2",
    ]);
  });

  it("never marks protected emails selected", () => {
    const messages = applyDefaultSelection([
      row({
        id: "p1",
        protectionStatus: "protected",
        suggestedAction: "keep",
        primaryCategory: "protected",
      }),
    ]);
    expect(messages[0].selected).toBe(false);
    expect(isSelectionBlocked(messages[0])).toBe(true);
    expect(isDefaultCleanupCandidate(messages[0])).toBe(false);
  });

  it("excludes Spam and Trash from selection", () => {
    const spam = row({
      id: "s1",
      isSpam: true,
      suggestedAction: "keep",
      labelIds: ["SPAM"],
    });
    const trash = row({
      id: "t1",
      isTrash: true,
      suggestedAction: "keep",
      labelIds: ["TRASH"],
    });
    expect(isDefaultCleanupCandidate(spam)).toBe(false);
    expect(isManuallySelectable(spam)).toBe(false);
    expect(isDefaultCleanupCandidate(trash)).toBe(false);
    expect(isManuallySelectable(trash)).toBe(false);
  });

  it("keeps selection count accurate after defaults are applied", () => {
    const messages = buildScan214();
    expect(summarizeScanSelectionStats(messages).selectedEligible).toBe(2);
    expect(messages.filter((m) => m.selected)).toHaveLength(2);
  });

  it("select-all for a category only selects trash candidates in that category", () => {
    const messages = buildScan214();
    // Pretend an older bug left many notifications selected.
    const polluted = messages.map((message) =>
      message.primaryCategory === "notifications"
        ? { ...message, selected: true }
        : message,
    );
    expect(polluted.filter((m) => m.selected).length).toBeGreaterThan(2);

    const afterClear = selectCategoryCandidates(
      polluted,
      "notifications",
      false,
      categoryOf,
    ) as TestRow[];
    expect(
      afterClear.filter(
        (m) => categoryOf(m) === "notifications" && m.selected,
      ),
    ).toHaveLength(0);

    const afterSelectNotifications = selectCategoryCandidates(
      afterClear,
      "notifications",
      true,
      categoryOf,
    ) as TestRow[];
    // Notifications are review-only here — Select must not re-select them.
    expect(
      afterSelectNotifications.filter(
        (m) => categoryOf(m) === "notifications" && m.selected,
      ),
    ).toHaveLength(0);

    const afterPromotions = selectCategoryCandidates(
      afterSelectNotifications,
      "promotions",
      true,
      categoryOf,
    ) as TestRow[];
    expect(afterPromotions.find((m) => m.id === "clutter-1")?.selected).toBe(
      true,
    );
    expect(summarizeScanSelectionStats(afterPromotions).selectedEligible).toBe(
      2,
    );
  });

  it("category filtering helpers do not select unrelated emails", () => {
    const messages = buildScan214();
    const next = selectCategoryCandidates(
      messages,
      "promotions",
      true,
      categoryOf,
    ) as TestRow[];
    expect(next.find((m) => m.id === "clutter-2")?.selected).toBe(true);
    expect(
      next.filter((m) => (m.id ?? "").startsWith("review-") && m.selected),
    ).toEqual([]);
  });

  it("supports manual selection and deselection of eligible emails", () => {
    const messages = buildScan214();
    const withReview = toggleManualSelection(
      messages,
      new Set(["review-0"]),
      true,
    );
    expect(withReview.find((m) => m.id === "review-0")?.selected).toBe(true);
    expect(isEligibleSelected(withReview.find((m) => m.id === "review-0")!)).toBe(
      true,
    );

    const cleared = toggleManualSelection(
      withReview,
      new Set(["clutter-1"]),
      false,
    );
    expect(cleared.find((m) => m.id === "clutter-1")?.selected).toBe(false);

    const blocked = toggleManualSelection(
      cleared,
      new Set(["prot-0"]),
      true,
    );
    expect(blocked.find((m) => m.id === "prot-0")?.selected).toBe(false);
  });

  it("does not double-count messages that carry duplicate Gmail labels", () => {
    const messages = applyDefaultSelection([
      row({
        id: "dup",
        suggestedAction: "trash",
        primaryCategory: "promotions",
        labelIds: [
          "INBOX",
          "CATEGORY_PROMOTIONS",
          "CATEGORY_PROMOTIONS",
          "UNREAD",
          "UNREAD",
        ],
      }),
    ]);
    const stats = summarizeScanSelectionStats(messages);
    expect(stats.total).toBe(1);
    expect(stats.clutter).toBe(1);
    expect(stats.selectedEligible).toBe(1);
  });

  it("reports zero selected and no cleanup candidates when the mailbox is empty of clutter", () => {
    const messages = applyDefaultSelection([
      row({
        id: "only-protected",
        protectionStatus: "protected",
        suggestedAction: "keep",
        primaryCategory: "protected",
      }),
      row({
        id: "only-spam",
        isSpam: true,
        suggestedAction: "keep",
        primaryCategory: "spam_like",
        labelIds: ["SPAM"],
      }),
    ]);
    const stats = summarizeScanSelectionStats(messages);
    expect(stats.clutter).toBe(0);
    expect(stats.selectedEligible).toBe(0);
  });

  it("rejects cleanup when selected messages are protected", () => {
    const protectedSelected = row({
      id: "bad",
      protectionStatus: "protected",
      suggestedAction: "keep",
      selected: true,
      primaryCategory: "protected",
      labelIds: ["INBOX", "IMPORTANT"],
    });
    expect(isEligibleSelected(protectedSelected)).toBe(false);
    expect(isManuallySelectable(protectedSelected)).toBe(false);

    const stats = summarizeScanSelectionStats([protectedSelected]);
    expect(stats.selectedEligible).toBe(0);
  });

  it("counts needs-review from suggested_action, not only the category name", () => {
    const messages = buildScan214();
    const stats = summarizeScanSelectionStats(messages);
    expect(stats.needsReview).toBe(57);
    expect(stats.clutter + stats.protected + stats.needsReview + stats.spam).toBe(
      214,
    );
  });
});
