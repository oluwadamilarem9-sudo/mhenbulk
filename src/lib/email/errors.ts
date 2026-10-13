import type { SendEmailErrorCode } from "@/lib/email/types";

export class EmailProviderError extends Error {
  readonly code: SendEmailErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      code: SendEmailErrorCode;
      retryable?: boolean;
      retryAfterMs?: number;
    },
  ) {
    super(message);
    this.name = "EmailProviderError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Gmail failures already pass a message that names Gmail, and those campaigns
 * keep the existing wording. Another provider can pass its own message.
 */
function providerMessage(canned: string, fallback?: string): string {
  if (fallback && !/gmail/i.test(fallback)) return fallback;
  return canned;
}

export function userFacingEmailError(
  code: SendEmailErrorCode | undefined,
  fallback?: string,
): string {
  switch (code) {
    case "auth_required":
      return providerMessage(
        "Your Gmail connection has expired. Please reconnect.",
        fallback,
      );
    case "rate_limited":
    case "quota_exceeded":
      return providerMessage(
        "Gmail sending quota was reached. The campaign has been paused.",
        fallback,
      );
    case "invalid_recipient":
      return fallback || "Unable to send to this recipient address.";
    case "provider_disabled":
      return providerMessage(
        "Gmail sending is not enabled for this app yet. Enable the Gmail API in Google Cloud, then resume the campaign.",
        fallback,
      );
    case "not_implemented":
      return "This email provider is not available yet.";
    case "network_error":
      return "Unable to send this email. It will be retried.";
    case "delivery_unknown":
      return providerMessage(
        "Gmail did not confirm whether this email was accepted. It was not retried to avoid sending a duplicate.",
        fallback,
      );
    case "provider_error":
    default:
      return fallback ?? "Unable to send this email. It will be retried.";
  }
}
