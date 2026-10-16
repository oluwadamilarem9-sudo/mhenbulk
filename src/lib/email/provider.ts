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

import { ResendProvider } from "@/lib/email/providers/resend";
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

/** Legacy env-based Resend adapter. Prefer account-based ResendProvider. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  private readonly inner: ResendProvider;

  constructor(
    apiKey: string,
    private readonly defaultFrom: string,
  ) {
    this.inner = new ResendProvider(apiKey, defaultFrom);
  }

  send(input: SendEmailInput): Promise<SendEmailResult> {
    return this.inner.send({
      ...input,
      from: input.from || this.defaultFrom,
    });
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
