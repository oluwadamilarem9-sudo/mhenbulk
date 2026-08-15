import type {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from "@/lib/email/types";

/**
 * Outlook / Microsoft 365 provider stub.
 * Architecture placeholder — not implemented in this phase.
 */
export class OutlookProvider implements EmailProvider {
  readonly name = "outlook";

  async send(_input?: SendEmailInput): Promise<SendEmailResult> {
    void _input;
    return {
      success: false,
      provider: this.name,
      retryable: false,
      errorCode: "not_implemented",
      error: "Outlook sending is not implemented yet.",
    };
  }

  static connect(): never {
    throw new Error("Outlook connect is not implemented yet.");
  }

  static disconnect(): never {
    throw new Error("Outlook disconnect is not implemented yet.");
  }

  static refreshAccessToken(): never {
    throw new Error("Outlook token refresh is not implemented yet.");
  }

  static getAccountIdentity(): never {
    throw new Error("Outlook account identity is not implemented yet.");
  }
}
