/**
 * Swappable email provider adapter.
 * Campaign/queue code depends on this interface, not a vendor SDK.
 */

export type {
  ConnectedAccountIdentity,
  EmailProvider,
  SendEmailErrorCode,
  SendEmailInput,
  SendEmailResult,
} from "@/lib/email/types";

import type { EmailProvider, SendEmailInput, SendEmailResult } from "@/lib/email/types";

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.info("[email:console]", {
      to: input.to,
      subject: input.subject,
      from: input.from,
      textPreview: input.text?.slice(0, 120),
    });

    return {
      success: true,
      provider: this.name,
      messageId: `console_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly defaultFrom: string,
  ) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    try {
      const from =
        input.fromName && input.from
          ? `${input.fromName} <${input.from}>`
          : input.from || this.defaultFrom;

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          headers: input.headers,
          reply_to: input.replyTo,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        return {
          success: false,
          provider: this.name,
          retryable: response.status === 429 || response.status >= 500,
          errorCode:
            response.status === 429 ? "rate_limited" : "provider_error",
          error: `Resend ${response.status}: ${body.slice(0, 300)}`,
        };
      }

      const data = (await response.json()) as { id?: string };

      return {
        success: true,
        provider: this.name,
        messageId: data.id,
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

/**
 * Legacy global provider for local/dev fallback only.
 * Campaign sending should prefer resolveEmailProviderForAccount().
 */
export function getEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER ?? "console";

  if (provider === "resend") {
    if (!process.env.RESEND_API_KEY) {
      throw new Error(
        "EMAIL_PROVIDER=resend requires RESEND_API_KEY. Refusing silent console fallback.",
      );
    }

    return new ResendEmailProvider(
      process.env.RESEND_API_KEY,
      process.env.EMAIL_FROM || "onboarding@resend.dev",
    );
  }

  return new ConsoleEmailProvider();
}
