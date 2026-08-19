import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { GmailProvider } from "@/lib/email/providers/gmail";

describe("GmailProvider timeout behavior", () => {
  const originalFetch = global.fetch;
  const originalTimeout = process.env.GMAIL_SEND_TIMEOUT_MS;

  beforeEach(() => {
    process.env.GMAIL_SEND_TIMEOUT_MS = "25";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GMAIL_SEND_TIMEOUT_MS = originalTimeout;
    vi.restoreAllMocks();
  });

  it("returns retryable error when Gmail request times out", async () => {
    global.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          (err as Error & { name: string }).name = "AbortError";
          reject(err);
        });
      });
    }) as typeof fetch;

    const provider = new GmailProvider("token", "sender@example.com", "Sender");
    const result = await provider.send({
      to: "to@example.com",
      subject: "Subject",
      html: "<p>Hello</p>",
      text: "Hello",
      from: "sender@example.com",
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toContain("timed out");
  });
});
