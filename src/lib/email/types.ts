export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>;
  /** Gmail thread to continue for a follow-up, when available. */
  threadId?: string;
};

export type SendEmailErrorCode =
  | "auth_required"
  | "rate_limited"
  | "quota_exceeded"
  | "invalid_recipient"
  /** The provider API is disabled/not configured for this app — not a user problem. */
  | "provider_disabled"
  | "provider_error"
  | "network_error"
  /** The request may have reached the provider; retrying could duplicate mail. */
  | "delivery_unknown"
  | "not_implemented";

export type SendEmailResult = {
  success: boolean;
  provider: string;
  messageId?: string;
  threadId?: string;
  /** True when the failure is temporary and worth retrying (rate limit, 5xx). */
  retryable?: boolean;
  error?: string;
  errorCode?: SendEmailErrorCode;
  /** Suggested delay before retrying (ms), e.g. from Retry-After. */
  retryAfterMs?: number;
};

export interface EmailProvider {
  readonly name: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export type ConnectedAccountIdentity = {
  email: string;
  displayName: string | null;
  providerAccountId: string;
};
