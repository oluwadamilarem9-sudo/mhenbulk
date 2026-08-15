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

export function userFacingEmailError(
  code: SendEmailErrorCode | undefined,
  fallback?: string,
): string {
  switch (code) {
    case "auth_required":
      return "Your Gmail connection has expired. Please reconnect.";
    case "rate_limited":
    case "quota_exceeded":
      return "Gmail sending quota was reached. The campaign has been paused.";
    case "invalid_recipient":
      return "Unable to send to this recipient address.";
    case "not_implemented":
      return "This email provider is not available yet.";
    case "network_error":
      return "Unable to send this email. It will be retried.";
    case "provider_error":
    default:
      return fallback ?? "Unable to send this email. It will be retried.";
  }
}
