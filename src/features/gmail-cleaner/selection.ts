import type { ClassificationResult } from "@/features/gmail-cleaner/classify";

export type SelectionMessageLike = {
  id?: string;
  gmailMessageId?: string;
  protectionStatus: string;
  suggestedAction: string;
  selected: boolean;
  isSpam: boolean;
  isTrash: boolean;
  isDraft: boolean;
  isSent: boolean;
  labelIds?: string[] | null;
};

const HARD_BLOCK_LABELS = new Set([
  "DRAFT",
  "SENT",
  "SPAM",
  "TRASH",
  "STARRED",
  "IMPORTANT",
]);

export function hasHardBlockedGmailLabel(
  labelIds: string[] | null | undefined,
): boolean {
  return (labelIds ?? []).some((label) => HARD_BLOCK_LABELS.has(label));
}

/** Messages that must never be offered or counted as cleanup selection. */
export function isSelectionBlocked(
  message: Pick<
    SelectionMessageLike,
    | "protectionStatus"
    | "isSpam"
    | "isTrash"
    | "isDraft"
    | "isSent"
    | "labelIds"
  >,
): boolean {
  if (message.protectionStatus === "protected") return true;
  if (message.isDraft || message.isSent || message.isSpam || message.isTrash) {
    return true;
  }
  return hasHardBlockedGmailLabel(message.labelIds);
}

/**
 * Default auto-select / "potential clutter" candidates.
 * Needs-review and keep suggestions are never auto-selected.
 */
export function isDefaultCleanupCandidate(
  message: Pick<
    SelectionMessageLike,
    | "protectionStatus"
    | "suggestedAction"
    | "isSpam"
    | "isTrash"
    | "isDraft"
    | "isSent"
    | "labelIds"
  >,
): boolean {
  if (isSelectionBlocked(message)) return false;
  return message.suggestedAction === "trash";
}

export function isDefaultCleanupCandidateFromClassification(
  result: ClassificationResult,
  flags: {
    isSpam: boolean;
    isTrash: boolean;
    isDraft: boolean;
    isSent: boolean;
    labelIds?: string[] | null;
  },
): boolean {
  return isDefaultCleanupCandidate({
    protectionStatus: result.protectionStatus,
    suggestedAction: result.suggestedAction,
    isSpam: flags.isSpam,
    isTrash: flags.isTrash,
    isDraft: flags.isDraft,
    isSent: flags.isSent,
    labelIds: flags.labelIds,
  });
}

/**
 * Manual checkbox eligibility: non-blocked messages, including needs-review.
 * Category bulk-select still uses default cleanup candidates only.
 */
export function isManuallySelectable(
  message: Pick<
    SelectionMessageLike,
    | "protectionStatus"
    | "isSpam"
    | "isTrash"
    | "isDraft"
    | "isSent"
    | "labelIds"
  >,
): boolean {
  return !isSelectionBlocked(message);
}

/** Currently selected and still eligible to run cleanup against. */
export function isEligibleSelected(
  message: SelectionMessageLike,
): boolean {
  return message.selected && isManuallySelectable(message);
}

export type ScanStatBuckets = {
  total: number;
  clutter: number;
  protected: number;
  needsReview: number;
  spam: number;
  trash: number;
  selectedEligible: number;
};

/**
 * Aggregate dashboard stats from message rows without double-counting.
 * Each message contributes to at most one of clutter / protected / needsReview
 * for the primary dashboard cards (spam/trash are separate mailbox flags).
 */
export function summarizeScanSelectionStats(
  messages: SelectionMessageLike[],
): ScanStatBuckets {
  let clutter = 0;
  let protectedCount = 0;
  let needsReview = 0;
  let spam = 0;
  let trash = 0;
  let selectedEligible = 0;

  for (const message of messages) {
    if (message.isSpam) spam += 1;
    if (message.isTrash) trash += 1;

    if (message.protectionStatus === "protected") {
      protectedCount += 1;
    } else if (isDefaultCleanupCandidate(message)) {
      clutter += 1;
    } else if (
      message.suggestedAction === "review" &&
      !message.isSpam &&
      !message.isTrash
    ) {
      needsReview += 1;
    }

    if (isEligibleSelected(message)) {
      selectedEligible += 1;
    }
  }

  return {
    total: messages.length,
    clutter,
    protected: protectedCount,
    needsReview,
    spam,
    trash,
    selectedEligible,
  };
}

export function applyDefaultSelection(
  messages: SelectionMessageLike[],
): Array<SelectionMessageLike & { selected: boolean }> {
  return messages.map((message) => ({
    ...message,
    selected: isDefaultCleanupCandidate(message),
  }));
}

export function toggleManualSelection(
  messages: SelectionMessageLike[],
  ids: Set<string>,
  selected: boolean,
): SelectionMessageLike[] {
  return messages.map((message) => {
    const key = message.id ?? message.gmailMessageId;
    if (!key || !ids.has(key)) return message;
    if (!isManuallySelectable(message)) {
      return { ...message, selected: false };
    }
    return { ...message, selected };
  });
}

export function selectCategoryCandidates(
  messages: SelectionMessageLike[],
  category: string,
  selected: boolean,
  getCategory: (message: SelectionMessageLike) => string,
): SelectionMessageLike[] {
  return messages.map((message) => {
    if (getCategory(message) !== category) return message;
    if (selected) {
      // Bulk select only default cleanup candidates (never needs-review).
      if (!isDefaultCleanupCandidate(message)) return message;
      return { ...message, selected: true };
    }
    // Clear any non-blocked selection in this category.
    if (isSelectionBlocked(message)) return message;
    return { ...message, selected: false };
  });
}
