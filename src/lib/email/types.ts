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
};

export type SendEmailErrorCode =
  | "auth_required"
  | "rate_limited"
  | "quota_exceeded"
  | "invalid_recipient"
  | "provider_error"
  | "network_error"
  | "not_implemented";

export type SendEmailResult = {
  success: boolean;
  provider: string;
  messageId?: string;
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
