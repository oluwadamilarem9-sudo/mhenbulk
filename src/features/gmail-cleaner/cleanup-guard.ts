import { classifyGmailMessage } from "@/features/gmail-cleaner/classify";
import type { GmailMessageMetadata } from "@/lib/google/gmail-mailbox";
import { GmailApiError } from "@/lib/google/gmail-mailbox";

export type LiveTrashGuardResult =
  | { ok: true }
  | {
      ok: false;
      status: "skipped" | "failed";
      reason: string;
      wasAlreadyTrash: boolean;
    };

/**
 * Decide whether a message is safe to trash using the latest Gmail metadata.
 * If metadata cannot be verified, cleanup must not proceed.
 */
export function evaluateLiveTrashProtection(
  metadata: GmailMessageMetadata | null,
  fetchError?: GmailApiError | null,
): LiveTrashGuardResult {
  if (fetchError) {
    if (fetchError.code === "not_found") {
      return {
        ok: false,
        status: "skipped",
        reason: "Message is no longer available in Gmail.",
        wasAlreadyTrash: false,
      };
    }
    return {
      ok: false,
      status: "skipped",
      reason: `Could not verify latest protection status (${fetchError.code}): ${fetchError.message}`,
      wasAlreadyTrash: false,
    };
  }

  if (!metadata) {
    return {
      ok: false,
      status: "skipped",
      reason: "Could not verify latest protection status: metadata missing.",
      wasAlreadyTrash: false,
    };
  }

  const labels = metadata.labelIds ?? [];
  if (labels.includes("TRASH")) {
    return {
      ok: false,
      status: "skipped",
      reason: "Message is already in Gmail Trash.",
      wasAlreadyTrash: true,
    };
  }
  if (labels.includes("SPAM")) {
    return {
      ok: false,
      status: "skipped",
      reason: "Message is in Gmail Spam and is not eligible for cleanup.",
      wasAlreadyTrash: false,
    };
  }
  if (labels.includes("DRAFT")) {
    return {
      ok: false,
      status: "skipped",
      reason: "Message became a draft and is protected from cleanup.",
      wasAlreadyTrash: false,
    };
  }
  if (labels.includes("SENT")) {
    return {
      ok: false,
      status: "skipped",
      reason: "Message is in Sent and is protected from cleanup.",
      wasAlreadyTrash: false,
    };
  }
  if (labels.includes("STARRED")) {
    return {
      ok: false,
      status: "skipped",
      reason: "Message was starred after the scan and is now protected.",
      wasAlreadyTrash: false,
    };
  }
  if (labels.includes("IMPORTANT")) {
    return {
      ok: false,
      status: "skipped",
      reason: "Message was marked Important after the scan and is now protected.",
      wasAlreadyTrash: false,
    };
  }

  const classified = classifyGmailMessage(metadata);
  if (classified.protectionStatus === "protected") {
    return {
      ok: false,
      status: "skipped",
      reason: `Protected by live recheck: ${classified.reason}`,
      wasAlreadyTrash: false,
    };
  }

  return { ok: true };
}
