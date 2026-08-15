import type {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from "@/lib/email/types";

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
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  if (input.replyTo) {
    headers.push(`Reply-To: ${input.replyTo}`);
  }

  if (input.headers) {
    for (const [key, value] of Object.entries(input.headers)) {
      if (!/^(from|to|subject|mime-version|content-type)$/i.test(key)) {
        headers.push(`${key}: ${value}`);
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
      const raw = buildMimeMessage({
        ...input,
        fromEmail: this.fromEmail,
        fromName: input.fromName ?? this.fromName ?? undefined,
      });

      const response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw: encodeBase64Url(raw) }),
        },
      );

      if (response.ok) {
        const data = (await response.json()) as { id?: string };
        return {
          success: true,
          provider: this.name,
          messageId: data.id,
        };
      }

      const body = await response.text();
      const retryAfterMs = parseRetryAfterMs(response);
      const lower = body.toLowerCase();

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
      return {
        success: false,
        provider: this.name,
        retryable: true,
        errorCode: "network_error",
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }
}
