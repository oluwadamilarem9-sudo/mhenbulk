import type {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from "@/lib/email/types";

const SEND_URL = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 20_000;

function failure(
  errorCode: SendEmailResult["errorCode"],
  error: string,
  options?: { retryable?: boolean; retryAfterMs?: number },
): SendEmailResult {
  return {
    success: false,
    provider: "resend",
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

function retryAfterMsFrom(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const asSeconds = Number(header);
  if (!Number.isNaN(asSeconds) && asSeconds >= 0) return asSeconds * 1000;
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

/**
 * Sends one recipient through Resend.
 * Mhenbulk still chooses the recipient, variant, and schedule.
 */
export class ResendProvider implements EmailProvider {
  readonly name = "resend";

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
        "Resend API key is missing. Reconnect this sending account.",
      );
    }

    const fromEmail = (input.from || this.fromEmail).trim();
    const fromName = (input.fromName ?? this.fromName ?? "").trim();
    if (!fromEmail || !input.to.trim() || (!input.html.trim() && !input.text?.trim())) {
      return failure(
        "provider_error",
        "Resend requires a sender, a recipient, and message content.",
      );
    }

    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
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
        },
        body: JSON.stringify({
          from,
          to: [input.to.trim()],
          subject: input.subject,
          ...(input.html.trim() ? { html: input.html } : {}),
          ...(input.text?.trim() ? { text: input.text } : {}),
          ...(input.headers ? { headers: input.headers } : {}),
          ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { id?: string };
        return {
          success: true,
          provider: this.name,
          messageId: typeof data.id === "string" ? data.id : undefined,
        };
      }

      const body = await response.text();
      const lower = body.toLowerCase();
      const safe = redact(body.slice(0, 300), apiKey);

      if (response.status === 401 || response.status === 403) {
        return failure(
          "auth_required",
          "Resend rejected the API key. Reconnect this sending account.",
        );
      }

      if (response.status === 429) {
        return failure(
          "rate_limited",
          "Resend rate limit was reached. The campaign has been paused.",
          {
            retryable: true,
            retryAfterMs: retryAfterMsFrom(response) ?? 60_000,
          },
        );
      }

      if (
        response.status === 422 ||
        lower.includes("invalid") ||
        lower.includes("not a valid")
      ) {
        return failure(
          "invalid_recipient",
          "Resend rejected this recipient address.",
        );
      }

      if (response.status >= 500) {
        return failure("provider_error", `Resend ${response.status}: ${safe}`, {
          retryable: true,
        });
      }

      return failure("provider_error", `Resend ${response.status}: ${safe}`);
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      const reason = error instanceof Error ? error.message : "Network error";
      return failure(
        "delivery_unknown",
        aborted
          ? "Resend did not confirm whether this email was accepted before the request timed out. It was not retried."
          : `Resend did not confirm whether this email was accepted. It was not retried. ${redact(reason, apiKey)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
