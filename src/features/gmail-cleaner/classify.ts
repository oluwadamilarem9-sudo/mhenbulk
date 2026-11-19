import type { GmailMessageMetadata } from "@/lib/google/gmail-mailbox";
import { parseFromHeader } from "@/lib/google/gmail-mailbox";

export type GmailCleanerCategory =
  | "promotions"
  | "newsletters"
  | "marketing"
  | "notifications"
  | "social_updates"
  | "old_conversations"
  | "spam_like"
  | "large_attachments"
  | "needs_review"
  | "already_trash"
  | "protected";

export type ClassificationConfidence = "low" | "medium" | "high";
export type ProtectionStatus = "none" | "protected";
export type SuggestedAction = "trash" | "review" | "keep";

export type ClassificationResult = {
  primaryCategory: GmailCleanerCategory;
  reason: string;
  confidence: ClassificationConfidence;
  protectionStatus: ProtectionStatus;
  suggestedAction: SuggestedAction;
  signals: string[];
};

const LARGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const OLD_CONVERSATION_DAYS = 365;

const FINANCIAL_RE =
  /\b(invoice|receipt|payment|paid|bank|banking|wire|transfer|statement|refund|billing|tax|payroll|salary|iban|swift|transaction|order\s*#|purchase)\b/i;
const SECURITY_RE =
  /\b(password|reset|otp|verification code|verify your|security alert|suspicious (login|sign[- ]?in)|2fa|two[- ]factor|mfa|account (locked|compromised)|confirm (your )?email)\b/i;
const LEGAL_RE =
  /\b(contract|agreement|nda|legal|lawsuit|subpoena|compliance|terms of service|privacy policy update)\b/i;
const BUSINESS_RE =
  /\b(proposal|quotation|quote|rfp|client|customer enquiry|inquiry|meeting|calendar invite|interview|offer letter)\b/i;
const NEWSLETTER_RE =
  /\b(newsletter|digest|weekly update|monthly update|unsubscribe)\b/i;
const PROMO_RE =
  /\b(%\s*off|sale|discount|deal|coupon|promo|free shipping|limited time|flash sale)\b/i;
const MARKETING_RE =
  /\b(webinar|demo|product launch|new feature|announcement|campaign)\b/i;
const NOTIFICATION_RE =
  /\b(notification|alert|reminder|your (order|package|shipment)|tracking|delivery update|github|gitlab|jira|slack|noreply)\b/i;

const SOCIAL_DOMAINS = new Set([
  "facebookmail.com",
  "linkedin.com",
  "lnkd.in",
  "twitter.com",
  "x.com",
  "instagram.com",
  "pinterest.com",
  "tiktok.com",
  "redditmail.com",
  "youtube.com",
]);

const NOTIFY_LOCALS = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "notifications",
  "notification",
  "alerts",
  "mailer-daemon",
]);

function domainOf(email: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  return email.split("@")[1]?.toLowerCase() ?? null;
}

function daysSince(isoMs: string | null, headerDate: string | undefined): number | null {
  let ms: number | null = null;
  if (isoMs && /^\d+$/.test(isoMs)) {
    ms = Number(isoMs);
  } else if (headerDate) {
    const parsed = Date.parse(headerDate);
    if (Number.isFinite(parsed)) ms = parsed;
  }
  if (ms == null) return null;
  return (Date.now() - ms) / (1000 * 60 * 60 * 24);
}

function hasLabel(labels: string[], label: string) {
  return labels.includes(label);
}

export function classifyGmailMessage(
  message: GmailMessageMetadata,
): ClassificationResult {
  const labels = message.labelIds ?? [];
  const from = parseFromHeader(message.headers.from);
  const subject = message.headers.subject ?? "";
  const snippet = message.snippet ?? "";
  const text = `${subject}\n${snippet}`;
  const senderEmail = from.email;
  const senderDomain = domainOf(senderEmail);
  const local = senderEmail?.split("@")[0]?.toLowerCase() ?? "";
  const signals: string[] = [];

  const isSpam = hasLabel(labels, "SPAM");
  const isTrash = hasLabel(labels, "TRASH");
  const isDraft = hasLabel(labels, "DRAFT");
  const isSent = hasLabel(labels, "SENT");
  const isImportant =
    hasLabel(labels, "IMPORTANT") || hasLabel(labels, "STARRED");
  const isPromoLabel = hasLabel(labels, "CATEGORY_PROMOTIONS");
  const isSocialLabel = hasLabel(labels, "CATEGORY_SOCIAL");
  const isUpdateLabel = hasLabel(labels, "CATEGORY_UPDATES");
  const isForumLabel = hasLabel(labels, "CATEGORY_FORUMS");

  const listUnsub = Boolean(message.headers["list-unsubscribe"]);
  const listId = Boolean(message.headers["list-id"]);
  const precedence = (message.headers.precedence ?? "").toLowerCase();
  const autoSubmitted = (message.headers["auto-submitted"] ?? "").toLowerCase();
  const bulk =
    precedence === "bulk" ||
    precedence === "list" ||
    precedence === "junk" ||
    (autoSubmitted && autoSubmitted !== "no");

  if (isSpam) signals.push("gmail:SPAM");
  if (isTrash) signals.push("gmail:TRASH");
  if (isDraft) signals.push("gmail:DRAFT");
  if (isSent) signals.push("gmail:SENT");
  if (isImportant) signals.push("gmail:important");
  if (listUnsub) signals.push("header:list-unsubscribe");
  if (listId) signals.push("header:list-id");
  if (bulk) signals.push("header:bulk");

  // --- Hard protection / reporting buckets ---
  if (isDraft) {
    return {
      primaryCategory: "protected",
      reason: "Drafts are never offered for cleanup.",
      confidence: "high",
      protectionStatus: "protected",
      suggestedAction: "keep",
      signals,
    };
  }

  if (isSent) {
    return {
      primaryCategory: "protected",
      reason: "Sent messages are protected from cleanup by default.",
      confidence: "high",
      protectionStatus: "protected",
      suggestedAction: "keep",
      signals,
    };
  }

  if (isSpam) {
    return {
      primaryCategory: "spam_like",
      reason: "Already in Gmail Spam — reported separately, not a new cleanup candidate.",
      confidence: "high",
      protectionStatus: "none",
      suggestedAction: "keep",
      signals,
    };
  }

  if (isTrash) {
    return {
      primaryCategory: "already_trash",
      reason: "Already in Gmail Trash — reported separately, not a new cleanup candidate.",
      confidence: "high",
      protectionStatus: "none",
      suggestedAction: "keep",
      signals,
    };
  }

  if (isImportant) {
    return {
      primaryCategory: "protected",
      reason: "Starred or Important messages are protected by default.",
      confidence: "high",
      protectionStatus: "protected",
      suggestedAction: "keep",
      signals,
    };
  }

  if (FINANCIAL_RE.test(text) || FINANCIAL_RE.test(subject)) {
    signals.push("rule:financial");
    return {
      primaryCategory: "protected",
      reason: "Looks financial (invoice, receipt, banking, or payment related).",
      confidence: "high",
      protectionStatus: "protected",
      suggestedAction: "keep",
      signals,
    };
  }

  if (SECURITY_RE.test(text) || SECURITY_RE.test(subject)) {
    signals.push("rule:security");
    return {
      primaryCategory: "protected",
      reason: "Looks like a security, password, or verification message.",
      confidence: "high",
      protectionStatus: "protected",
      suggestedAction: "keep",
      signals,
    };
  }

  if (LEGAL_RE.test(text) || LEGAL_RE.test(subject)) {
    signals.push("rule:legal");
    return {
      primaryCategory: "protected",
      reason: "Looks like legal or contractual correspondence.",
      confidence: "high",
      protectionStatus: "protected",
      suggestedAction: "keep",
      signals,
    };
  }

  if (BUSINESS_RE.test(text) || BUSINESS_RE.test(subject)) {
    signals.push("rule:business");
    return {
      primaryCategory: "protected",
      reason: "Looks like a business enquiry, proposal, or client conversation.",
      confidence: "medium",
      protectionStatus: "protected",
      suggestedAction: "keep",
      signals,
    };
  }

  // Personal inbox conversations without bulk markers stay protected / review.
  const isPersonalInbox =
    hasLabel(labels, "INBOX") &&
    hasLabel(labels, "CATEGORY_PERSONAL") &&
    !listUnsub &&
    !bulk &&
    !isPromoLabel;

  if (isPersonalInbox && !NOTIFY_LOCALS.has(local)) {
    signals.push("rule:personal-thread");
    return {
      primaryCategory: "protected",
      reason: "Appears to be a personal or client conversation in Primary.",
      confidence: "medium",
      protectionStatus: "protected",
      suggestedAction: "keep",
      signals,
    };
  }

  // --- Cleanup / review candidates ---
  if (
    (message.sizeEstimate ?? 0) >= LARGE_ATTACHMENT_BYTES &&
    (isPromoLabel || listUnsub || bulk)
  ) {
    signals.push("rule:large-attachment");
    return {
      primaryCategory: "large_attachments",
      reason: "Large message with bulk/promotional signals.",
      confidence: "medium",
      protectionStatus: "none",
      suggestedAction: "trash",
      signals,
    };
  }

  if (isSocialLabel || (senderDomain && SOCIAL_DOMAINS.has(senderDomain))) {
    signals.push("rule:social");
    return {
      primaryCategory: "social_updates",
      reason: "Gmail Social category or known social notification sender.",
      confidence: isSocialLabel ? "high" : "medium",
      protectionStatus: "none",
      suggestedAction: "trash",
      signals,
    };
  }

  if (
    (listUnsub || listId || bulk) &&
    (NEWSLETTER_RE.test(text) || listId)
  ) {
    signals.push("rule:newsletter");
    return {
      primaryCategory: "newsletters",
      reason: "List headers plus newsletter language.",
      confidence: "high",
      protectionStatus: "none",
      suggestedAction: "trash",
      signals,
    };
  }

  if (isPromoLabel || (listUnsub && PROMO_RE.test(text))) {
    signals.push("rule:promotions");
    return {
      primaryCategory: "promotions",
      reason: isPromoLabel
        ? "Gmail Promotions category."
        : "List-Unsubscribe with promotional language.",
      confidence: isPromoLabel ? "high" : "medium",
      protectionStatus: "none",
      suggestedAction: "trash",
      signals,
    };
  }

  if (
    (listUnsub || bulk || NOTIFY_LOCALS.has(local)) &&
    MARKETING_RE.test(text)
  ) {
    signals.push("rule:marketing");
    return {
      primaryCategory: "marketing",
      reason: "Automated marketing / product announcement signals.",
      confidence: "medium",
      protectionStatus: "none",
      suggestedAction: "trash",
      signals,
    };
  }

  if (
    isUpdateLabel ||
    isForumLabel ||
    NOTIFY_LOCALS.has(local) ||
    (NOTIFICATION_RE.test(text) && (listUnsub || bulk || autoSubmitted))
  ) {
    signals.push("rule:notifications");
    return {
      primaryCategory: "notifications",
      reason: "Automated notification or Updates/Forums label.",
      confidence: "medium",
      protectionStatus: "none",
      suggestedAction: "review",
      signals,
    };
  }

  const ageDays = daysSince(message.internalDate, message.headers.date);
  if (
    ageDays != null &&
    ageDays >= OLD_CONVERSATION_DAYS &&
    (listUnsub || bulk || isPromoLabel || isUpdateLabel)
  ) {
    // Age alone never qualifies — only with clutter signals.
    signals.push("rule:old+clutter");
    return {
      primaryCategory: "old_conversations",
      reason: `Older than ${OLD_CONVERSATION_DAYS} days and shows bulk/promotional signals.`,
      confidence: "medium",
      protectionStatus: "none",
      suggestedAction: "review",
      signals,
    };
  }

  if (listUnsub || bulk) {
    signals.push("rule:uncertain-bulk");
    return {
      primaryCategory: "needs_review",
      reason: "Bulk or list signals without a confident category.",
      confidence: "low",
      protectionStatus: "none",
      suggestedAction: "review",
      signals,
    };
  }

  if (PROMO_RE.test(text) && !listUnsub) {
    // Promotional language alone is not enough to trash.
    signals.push("rule:promo-language-only");
    return {
      primaryCategory: "needs_review",
      reason: "Promotional language without reliable bulk sender evidence.",
      confidence: "low",
      protectionStatus: "none",
      suggestedAction: "review",
      signals,
    };
  }

  return {
    primaryCategory: "needs_review",
    reason: "No strong clutter or protection signal — left for manual review.",
    confidence: "low",
    protectionStatus: "none",
    suggestedAction: "review",
    signals,
  };
}

export function isCleanupCandidate(result: ClassificationResult): boolean {
  // Spam/Trash/Draft/Sent are classified as keep/protected before trash suggestions.
  return (
    result.protectionStatus !== "protected" &&
    result.suggestedAction === "trash"
  );
}

export const CATEGORY_LABELS: Record<GmailCleanerCategory, string> = {
  promotions: "Promotions",
  newsletters: "Newsletters",
  marketing: "Marketing",
  notifications: "Notifications",
  social_updates: "Social Updates",
  old_conversations: "Old Conversations",
  spam_like: "Already in Spam",
  large_attachments: "Large Attachments",
  needs_review: "Uncertain / needs review",
  already_trash: "Already in Trash",
  protected: "Protected",
};

/** Categories that are mailbox-state / protected and never bulk-selected. */
export const NON_SELECTABLE_CATEGORIES: ReadonlySet<GmailCleanerCategory> =
  new Set(["protected", "spam_like", "already_trash"]);
