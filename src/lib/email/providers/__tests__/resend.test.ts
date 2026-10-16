import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResendProvider } from "@/lib/email/providers/resend";

const API_KEY = "re_unit_test_key";

describe("ResendProvider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("maps HTTP 200 to the Resend message id", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_resend_1" }), { status: 200 }),
    );

    const result = await new ResendProvider(API_KEY, "hello@mhenbulk.store", "Mhenbulk").send({
      to: "ada@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
      headers: { "List-Unsubscribe": "<https://example.com/unsub>" },
    });

    expect(result).toMatchObject({
      success: true,
      provider: "resend",
      messageId: "msg_resend_1",
    });
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${API_KEY}`,
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: "Mhenbulk <hello@mhenbulk.store>",
      to: ["ada@example.com"],
      subject: "Hello",
    });
  });

  it("does not retry authentication failures", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: "API key is invalid" }), { status: 401 }),
    );

    const result = await new ResendProvider(API_KEY, "hello@mhenbulk.store").send({
      to: "ada@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
    });

    expect(result).toMatchObject({
      success: false,
      retryable: false,
      errorCode: "auth_required",
    });
    expect(result.error).not.toContain(API_KEY);
  });

  it("maps rate limits with Retry-After", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "12" },
      }),
    );

    const result = await new ResendProvider(API_KEY, "hello@mhenbulk.store").send({
      to: "ada@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
    });

    expect(result).toMatchObject({
      success: false,
      retryable: true,
      errorCode: "rate_limited",
      retryAfterMs: 12_000,
    });
  });

  it("marks ambiguous network failures as delivery_unknown", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError("fetch failed"));

    const result = await new ResendProvider(API_KEY, "hello@mhenbulk.store").send({
      to: "ada@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
    });

    expect(result).toMatchObject({
      success: false,
      retryable: false,
      errorCode: "delivery_unknown",
    });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });
});
