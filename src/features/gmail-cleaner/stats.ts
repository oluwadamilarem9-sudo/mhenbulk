import type { GmailCleanerCategory } from "@/features/gmail-cleaner/classify";
import {
  isDefaultCleanupCandidate,
  isEligibleSelected,
  type SelectionMessageLike,
} from "@/features/gmail-cleaner/selection";

export type StatsMessage = SelectionMessageLike & {
  primaryCategory: GmailCleanerCategory;
};

export type DashboardStatCards = {
  scanned: number;
  potentialClutter: number;
  protected: number;
  /** Uncertain messages suggested for manual review (not already spam/trash). */
  manualReview: number;
  alreadyInSpam: number;
  alreadyInTrash: number;
  selectedEligible: number;
};

export type CategoryStatBreakdown = Record<GmailCleanerCategory, number>;

export function emptyCategoryStats(): CategoryStatBreakdown {
  return {
    promotions: 0,
    newsletters: 0,
    marketing: 0,
    notifications: 0,
    social_updates: 0,
    old_conversations: 0,
    spam_like: 0,
    large_attachments: 0,
    needs_review: 0,
    already_trash: 0,
    protected: 0,
  };
}

/**
 * Mutually exclusive category bucket for dashboard category tiles.
 *
 * - Fresh scans store Trash (non-draft/sent) as `already_trash`.
 * - Legacy rows stored Trash under `needs_review`; remap those here.
 * - Draft/Sent mail classified as `protected` keeps that category even if it
 *   also carries a TRASH label (Already in Trash card still counts the flag).
 */
export function displayCategoryForStats(
  message: StatsMessage,
): GmailCleanerCategory {
  if (
    message.isTrash &&
    (message.primaryCategory === "needs_review" ||
      message.primaryCategory === "already_trash")
  ) {
    return "already_trash";
  }
  if (message.isSpam && message.primaryCategory !== "protected") {
    return "spam_like";
  }
  return message.primaryCategory;
}

export function isManualReviewCandidate(message: SelectionMessageLike): boolean {
  if (message.protectionStatus === "protected") return false;
  if (message.isSpam || message.isTrash || message.isDraft || message.isSent) {
    return false;
  }
  return message.suggestedAction === "review";
}

/**
 * Aggregate scan statistics. Each message is counted once in the scanned total
 * and once in exactly one category tile (via displayCategoryForStats).
 *
 * Spam/Trash *cards* count mailbox flags and may overlap Protected (e.g. Sent
 * mail that also carries TRASH). Category tiles stay mutually exclusive.
 */
export function aggregateGmailCleanerStats(
  messages: StatsMessage[],
): {
  cards: DashboardStatCards;
  categories: CategoryStatBreakdown;
  categorySum: number;
} {
  const categories = emptyCategoryStats();
  let potentialClutter = 0;
  let protectedCount = 0;
  let manualReview = 0;
  let alreadyInSpam = 0;
  let alreadyInTrash = 0;
  let selectedEligible = 0;

  for (const message of messages) {
    categories[displayCategoryForStats(message)] += 1;

    if (message.isSpam) alreadyInSpam += 1;
    if (message.isTrash) alreadyInTrash += 1;
    if (message.protectionStatus === "protected") protectedCount += 1;
    if (isDefaultCleanupCandidate(message)) potentialClutter += 1;
    if (isManualReviewCandidate(message)) manualReview += 1;
    if (isEligibleSelected(message)) selectedEligible += 1;
  }

  const categorySum = (Object.values(categories) as number[]).reduce(
    (sum, value) => sum + value,
    0,
  );

  return {
    cards: {
      scanned: messages.length,
      potentialClutter,
      protected: protectedCount,
      manualReview,
      alreadyInSpam,
      alreadyInTrash,
      selectedEligible,
    },
    categories,
    categorySum,
  };
}
