/**
 * Swappable email provider adapter.
 * Campaign/queue code depends on this interface, not a vendor SDK.
 */

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>;
};

export type SendEmailResult = {
  success: boolean;
  provider: string;
  messageId?: string;
  /** True when the failure is temporary and worth retrying (rate limit, 5xx). */
  retryable?: boolean;
  error?: string;
};

export interface EmailProvider {
  readonly name: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

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
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: input.from || this.defaultFrom,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          headers: input.headers,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        return {
          success: false,
          provider: this.name,
          retryable: response.status === 429 || response.status >= 500,
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
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }
}

export function getEmailProvider(): EmailProvider {
  const provider = process.env.EMAIL_PROVIDER ?? "console";

  if (provider === "resend" && process.env.RESEND_API_KEY) {
    return new ResendEmailProvider(
      process.env.RESEND_API_KEY,
      process.env.EMAIL_FROM || "onboarding@resend.dev",
    );
  }

  return new ConsoleEmailProvider();
}
