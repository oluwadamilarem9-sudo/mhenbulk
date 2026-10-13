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

  it("does not forward an idempotency key to the Gmail API", async () => {
    let body = "";
    let url = "";
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: "gmail-id", threadId: "thread-1" }), {
        status: 200,
      });
    }) as typeof fetch;

    const provider = new GmailProvider("token", "sender@example.com", "Sender");
    const result = await provider.send({
      to: "to@example.com",
      subject: "Subject",
      html: "<p>Hello</p>",
      text: "Hello",
      idempotencyKey: "mhenbulk:11111111-1111-4111-8111-111111111111",
      threadId: "thread-1",
      sandbox: true,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("gmail-id");
    expect(result.threadId).toBe("thread-1");
    const request = JSON.parse(body) as Record<string, unknown>;
    expect(url).toContain("gmail.googleapis.com");
    expect(request.threadId).toBe("thread-1");
    expect(request).not.toHaveProperty("idempotency_key");
    expect(request).not.toHaveProperty("sandbox");
    expect(Object.keys(request)).not.toContain("Sandbox");
  });
});
