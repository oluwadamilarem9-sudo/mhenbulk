import { createHash } from "node:crypto";

import type {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from "@/lib/email/types";

const SEND_URL = "https://api.misar.io/mail/v1/send";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_IDEMPOTENCY_LENGTH = 128;

/**
 * Stable key for one campaign recipient row. Retries of that row reuse it.
 * A UUID recipient id keeps the key inside MisarMail's 128-character limit.
 */
export function misarmailIdempotencyKey(recipientId: string): string {
  return `mhenbulk:${recipientId}`;
}

/** Stable key for one test-send target. Repeating that test reuses the key. */
export function misarmailTestIdempotencyKey(scopeId: string, recipient: string): string {
  const digest = createHash("sha256")
    .update(recipient.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
  return `mhenbulk-test:${scopeId}:${digest}`;
}

export function misarmailTestSendOptions(
  providerName: string,
  scopeId: string,
  recipient: string,
): { sandbox?: true; idempotencyKey?: string } {
  if (providerName !== "misarmail") return {};
  return {
    sandbox: true,
    idempotencyKey: misarmailTestIdempotencyKey(scopeId, recipient),
  };
}

export function testSendSuccessMessage(providerName: string, to: string, from?: string): string {
  if (providerName === "misarmail") {
    return `MisarMail accepted the sandbox test for ${to}. No email was delivered.`;
  }
  if (providerName === "resend") {
    return from
      ? `Test email sent to ${to} from ${from} via Resend.`
      : `Test email sent to ${to} via Resend.`;
  }
  if (from) return `Test email sent to ${to} from ${from}.`;
  return `Test email sent to ${to}.`;
}

function failure(
  errorCode: SendEmailResult["errorCode"],
  error: string,
  options?: { retryable?: boolean; retryAfterMs?: number },
): SendEmailResult {
  return {
    success: false,
    provider: "misarmail",
    retryable: options?.retryable ?? false,
    errorCode,
    error,
    retryAfterMs: options?.retryAfterMs,
  };
}

function redact(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

function isValidIdempotencyKey(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_IDEMPOTENCY_LENGTH &&
    /^[A-Za-z0-9:._-]+$/.test(value)
  );
}

function msUntilNextUtcDay(): number {
  const resumeAt = new Date();
  resumeAt.setUTCHours(24, 0, 0, 0);
  return Math.max(60_000, resumeAt.getTime() - Date.now());
}

function retryAfterMsFrom(response: Response, body: Record<string, unknown> | null): number | undefined {
  const header = response.headers.get("retry-after");
  if (header) {
    const asSeconds = Number(header);
    if (!Number.isNaN(asSeconds) && asSeconds >= 0) return asSeconds * 1000;
    const asDate = Date.parse(header);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  }

  const fromBody = body?.retryAfter;
  if (typeof fromBody === "number" && Number.isFinite(fromBody) && fromBody >= 0) {
    return fromBody * 1000;
  }

  return undefined;
}

function readJson(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function messageIdFrom(body: Record<string, unknown> | null): string | undefined {
  const messageId = body?.message_id;
  return typeof messageId === "string" && messageId.trim() ? messageId : undefined;
}

/**
 * Sends one recipient through MisarMail's transactional API.
 * Mhenbulk still chooses the recipient, variant, and schedule.
 * This adapter makes one request and does not retry it.
 */
export class MisarMailProvider implements EmailProvider {
  readonly name = "misarmail";

  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
    private readonly fromName?: string | null,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const apiKey = this.apiKey.trim();
    if (!apiKey) {
      return failure(
        "auth_required",
        "MisarMail API key is missing. Reconnect this sending account.",
      );
    }

    const idempotencyKey = input.idempotencyKey?.trim() ?? "";
    if (!isValidIdempotencyKey(idempotencyKey)) {
      return failure(
        "provider_error",
        "MisarMail send is missing a stable recipient idempotency key, so it was not attempted.",
      );
    }

    const fromEmail = (input.from || this.fromEmail).trim();
    const fromName = (input.fromName ?? this.fromName ?? "").trim();
    if (!fromEmail || !input.to.trim() || (!input.html.trim() && !input.text?.trim())) {
      return failure(
        "provider_error",
        "MisarMail requires a sender, a recipient, and message content.",
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(SEND_URL, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(input.sandbox ? { "X-MisarMail-Sandbox": "true" } : {}),
        },
        body: JSON.stringify({
          from: {
            email: fromEmail,
            ...(fromName ? { name: fromName } : {}),
          },
          to: [{ email: input.to.trim() }],
          subject: input.subject,
          ...(input.html.trim() ? { html: input.html } : {}),
          ...(input.text?.trim() ? { text: input.text } : {}),
          idempotency_key: idempotencyKey,
        }),
      });

      const raw = await response.text();
      const body = readJson(raw);
      const messageId = messageIdFrom(body);

      // 200 and 202 both mean MisarMail accepted the request. `sent` in
      // Mhenbulk means accepted, not delivered. 202 may omit message_id.
      if (response.status === 200 || response.status === 202) {
        if (body?.success === false) {
          return failure(
            "provider_error",
            "MisarMail accepted the HTTP status but reported the send as unsuccessful.",
          );
        }
        return {
          success: true,
          provider: this.name,
          messageId,
        };
      }

      const errorText =
        typeof body?.error === "string" && body.error.trim()
          ? body.error.trim().slice(0, 300)
          : `MisarMail returned HTTP ${response.status}.`;
      const code = typeof body?.code === "string" ? body.code : "";

      if (response.status === 422) {
        return failure(
          "invalid_recipient",
          "MisarMail suppressed this recipient and the send was not retried.",
        );
      }

      if (response.status === 429) {
        return failure("rate_limited", "MisarMail rate limit was reached. The campaign has been paused.", {
          retryable: true,
          retryAfterMs: retryAfterMsFrom(response, body),
        });
      }

      if (response.status === 403 && (code === "plan_limit_exceeded" || errorText.includes("plan_limit_exceeded"))) {
        return failure(
          "quota_exceeded",
          "MisarMail plan limit was reached. The campaign has been paused.",
          { retryAfterMs: msUntilNextUtcDay() },
        );
      }

      if (response.status === 401 || response.status === 403) {
        return failure(
          "auth_required",
          "MisarMail rejected the API key. Reconnect this sending account.",
        );
      }

      if (response.status >= 500) {
        return failure("provider_error", redact(errorText, apiKey), {
          retryable: true,
        });
      }

      return failure("provider_error", redact(errorText, apiKey));
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      const reason = error instanceof Error ? error.message : "Network error";
      return failure(
        "delivery_unknown",
        aborted
          ? "MisarMail did not confirm whether this email was accepted before the request timed out. It was not retried."
          : `MisarMail did not confirm whether this email was accepted. It was not retried. ${redact(reason, apiKey)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
