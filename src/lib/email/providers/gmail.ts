import type {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from "@/lib/email/types";
import { getQueueConfig } from "@/lib/env";

function encodeBase64Url(value: Buffer | string): string {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function formatFromHeader(email: string, displayName?: string | null): string {
  if (!displayName?.trim()) {
    return email;
  }

  const safeName = displayName.replace(/[\r\n"]/g, "").trim();
  return `"${safeName}" <${email}>`;
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\0]+/g, " ").trim();
}

function buildMimeMessage(input: SendEmailInput & { fromEmail: string }): string {
  const boundary = `mhenbulk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const from = formatFromHeader(input.fromEmail, input.fromName ?? input.from);
  const text =
    input.text?.trim() ||
    input.html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const headers: string[] = [
    `From: ${from}`,
    `To: ${sanitizeHeaderValue(input.to)}`,
    `Subject: ${sanitizeHeaderValue(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  if (input.replyTo) {
    headers.push(`Reply-To: ${sanitizeHeaderValue(input.replyTo)}`);
  }

  if (input.headers) {
    for (const [key, value] of Object.entries(input.headers)) {
      if (
        /^[A-Za-z0-9-]+$/.test(key) &&
        !/^(from|to|subject|mime-version|content-type)$/i.test(key)
      ) {
        headers.push(`${key}: ${sanitizeHeaderValue(value)}`);
      }
    }
  }

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    input.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

function parseRetryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;

  const asSeconds = Number(header);
  if (!Number.isNaN(asSeconds) && asSeconds >= 0) {
    return asSeconds * 1000;
  }

  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }

  return undefined;
}

export class GmailProvider implements EmailProvider {
  readonly name = "gmail";

  constructor(
    private readonly accessToken: string,
    private readonly fromEmail: string,
    private readonly fromName?: string | null,
  ) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const { gmailSendTimeoutMs } = getQueueConfig();
      const raw = buildMimeMessage({
        ...input,
        fromEmail: this.fromEmail,
        fromName: input.fromName ?? this.fromName ?? undefined,
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), gmailSendTimeoutMs);
      let response: Response;
      try {
        response = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              raw: encodeBase64Url(raw),
              ...(input.threadId ? { threadId: input.threadId } : {}),
            }),
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }

      if (response.ok) {
        const data = (await response.json()) as { id?: string; threadId?: string };
        return {
          success: true,
          provider: this.name,
          messageId: data.id,
          threadId: data.threadId,
        };
      }

      const body = await response.text();
      const retryAfterMs = parseRetryAfterMs(response);
      const lower = body.toLowerCase();

      console.error("[gmail] send failed", response.status, body.slice(0, 600));

      // Google reports a disabled API as 403 PERMISSION_DENIED, which must not
      // be mistaken for an expired user token.
      if (
        lower.includes("service_disabled") ||
        lower.includes("accessnotconfigured") ||
        lower.includes("has not been used in project")
      ) {
        return {
          success: false,
          provider: this.name,
          retryable: false,
          errorCode: "provider_disabled",
          error: `Gmail API is not enabled for this Google Cloud project: ${body.slice(0, 300)}`,
        };
      }

      if (response.status === 401 || response.status === 403) {
        const authRelated =
          lower.includes("invalid_grant") ||
          lower.includes("auth") ||
          lower.includes("permission") ||
          lower.includes("insufficient") ||
          response.status === 401;

        if (authRelated && !lower.includes("ratelimit") && !lower.includes("quota")) {
          return {
            success: false,
            provider: this.name,
            retryable: false,
            errorCode: "auth_required",
            error: "Gmail authorization is no longer valid.",
          };
        }
      }

      if (
        response.status === 429 ||
        lower.includes("ratelimit") ||
        lower.includes("rate limit") ||
        lower.includes("quota") ||
        lower.includes("user-rate-limit")
      ) {
        return {
          success: false,
          provider: this.name,
          retryable: true,
          errorCode: lower.includes("quota") ? "quota_exceeded" : "rate_limited",
          error: "Gmail rate limit or quota was reached.",
          retryAfterMs: retryAfterMs ?? 15 * 60_000,
        };
      }

      if (response.status >= 500) {
        return {
          success: false,
          provider: this.name,
          retryable: true,
          errorCode: "provider_error",
          error: `Gmail ${response.status}: ${body.slice(0, 300)}`,
          retryAfterMs,
        };
      }

      return {
        success: false,
        provider: this.name,
        retryable: false,
        errorCode: "provider_error",
        error: `Gmail ${response.status}: ${body.slice(0, 300)}`,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          success: false,
          provider: this.name,
          retryable: true,
          errorCode: "provider_error",
          error: "Gmail request timed out.",
        };
      }
      return {
        success: false,
        provider: this.name,
        retryable: false,
        errorCode: "delivery_unknown",
        error:
          error instanceof Error
            ? `Gmail request outcome is unknown: ${error.message}`
            : "Gmail request outcome is unknown.",
      };
    }
  }
}
