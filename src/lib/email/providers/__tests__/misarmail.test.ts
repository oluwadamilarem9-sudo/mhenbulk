import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { userFacingEmailError } from "@/lib/email/errors";
import {
  MisarMailProvider,
  misarmailIdempotencyKey,
} from "@/lib/email/providers/misarmail";
import type { SendEmailInput } from "@/lib/email/types";

const RECIPIENT_ID = "11111111-1111-4111-8111-111111111111";
const API_KEY = "msk_unit_test_key";

const message: SendEmailInput = {
  to: "ada@example.com",
  subject: "Hello Ada",
  html: "<p>Hello Ada</p>",
  text: "Hello Ada",
  from: "news@example.com",
  fromName: "News",
  idempotencyKey: misarmailIdempotencyKey(RECIPIENT_ID),
  headers: {
    "List-Unsubscribe": "<https://example.com/unsub>",
  },
  threadId: "gmail-thread-1",
};

function jsonResponse(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("MisarMailProvider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn() as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function sentBodies(): unknown[] {
    return vi.mocked(global.fetch).mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)),
    );
  }

  it("maps HTTP 200 to the provider message id", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(200, {
        success: true,
        message_id: "msg_200",
        provider: "misar",
        timestamp: "2026-10-12T00:00:00.000Z",
      }),
    );

    const result = await new MisarMailProvider(API_KEY, "news@example.com", "News").send(
      message,
    );

    expect(result).toMatchObject({
      success: true,
      provider: "misarmail",
      messageId: "msg_200",
    });
    expect(result.threadId).toBeUndefined();

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("https://api.misar.io/mail/v1/send");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${API_KEY}`,
    );
    expect(sentBodies()[0]).toEqual({
      from: { email: "news@example.com", name: "News" },
      to: [{ email: "ada@example.com" }],
      subject: "Hello Ada",
      html: "<p>Hello Ada</p>",
      text: "Hello Ada",
      idempotency_key: `mhenbulk:${RECIPIENT_ID}`,
    });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it("treats HTTP 202 as accepted and does not invent a message id", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(202, { success: true, queued: true }),
    );

    const result = await new MisarMailProvider(API_KEY, "news@example.com").send(message);

    expect(result.success).toBe(true);
    expect(result.messageId).toBeUndefined();
    expect(result.errorCode).toBeUndefined();
  });

  it("keeps a message id that MisarMail actually returned with HTTP 202", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(202, { success: true, queued: true, message_id: "msg_queued" }),
    );

    const result = await new MisarMailProvider(API_KEY, "news@example.com").send(message);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg_queued");
  });

  it("does not retry a suppressed recipient", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(422, { success: false, error: "suppressed" }),
    );

    const result = await new MisarMailProvider(API_KEY, "news@example.com").send(message);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe("invalid_recipient");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 429 retry timing from Retry-After and does not retry inside the adapter", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(429, { success: false, error: "rate_limited", retryAfter: 90 }, {
        "Retry-After": "2",
      }),
    );

    const result = await new MisarMailProvider(API_KEY, "news@example.com").send(message);

    expect(result).toMatchObject({
      success: false,
      retryable: true,
      errorCode: "rate_limited",
      retryAfterMs: 2_000,
    });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it("uses the JSON retryAfter when the header is absent", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(429, { success: false, retryAfter: 30 }),
    );

    const result = await new MisarMailProvider(API_KEY, "news@example.com").send(message);

    expect(result.retryAfterMs).toBe(30_000);
  });

  it("pauses for a plan limit instead of marking the attempt retryable", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(403, { success: false, code: "plan_limit_exceeded" }),
    );

    const result = await new MisarMailProvider(API_KEY, "news@example.com").send(message);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe("quota_exceeded");
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(60_000);
    expect(result.error).toContain("MisarMail");
    expect(result.error?.toLowerCase()).not.toContain("gmail");
  });

  it("does not retry an authentication failure", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(401, { success: false, error: "unauthorized" }),
    );

    const result = await new MisarMailProvider(API_KEY, "news@example.com").send(message);

    expect(result).toMatchObject({
      success: false,
      retryable: false,
      errorCode: "auth_required",
    });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it("does not resend after a timeout", async () => {
    vi.mocked(global.fetch).mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });

    const result = await new MisarMailProvider(
      API_KEY,
      "news@example.com",
      null,
      25,
    ).send(message);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe("delivery_unknown");
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it("does not resend after an ambiguous network failure", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError("fetch failed"));

    const result = await new MisarMailProvider(API_KEY, "news@example.com").send(message);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.errorCode).toBe("delivery_unknown");
    expect(result.error).not.toContain(API_KEY);
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it("reuses the same idempotency key for the same recipient", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(200, { success: true, message_id: "msg_200", idempotent: true }),
    );

    const provider = new MisarMailProvider(API_KEY, "news@example.com", "News");
    await provider.send(message);
    await provider.send(message);

    const bodies = sentBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      idempotency_key: `mhenbulk:${RECIPIENT_ID}`,
    });
    expect(bodies[1]).toMatchObject({
      idempotency_key: bodies[0] && (bodies[0] as { idempotency_key: string }).idempotency_key,
    });
    expect(misarmailIdempotencyKey(RECIPIENT_ID).length).toBeLessThanOrEqual(128);
  });

  it("does not call MisarMail when the API key or idempotency key is missing", async () => {
    const missingKey = await new MisarMailProvider("  ", "news@example.com").send(message);
    const missingIdempotency = await new MisarMailProvider(API_KEY, "news@example.com").send({
      ...message,
      idempotencyKey: undefined,
    });
    const tooLong = await new MisarMailProvider(API_KEY, "news@example.com").send({
      ...message,
      idempotencyKey: "mhenbulk:" + "a".repeat(130),
    });

    expect(missingKey).toMatchObject({ success: false, errorCode: "auth_required", retryable: false });
    expect(missingIdempotency).toMatchObject({
      success: false,
      errorCode: "provider_error",
      retryable: false,
    });
    expect(tooLong.retryable).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("lets a server error be retried by the queue exactly once per attempt", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(503, { success: false, error: "unavailable" }),
    );

    const result = await new MisarMailProvider(API_KEY, "news@example.com").send(message);

    expect(result).toMatchObject({
      success: false,
      retryable: true,
      errorCode: "provider_error",
    });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it("adds the sandbox header only when a test send asks for it", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(200, { success: true, message_id: "sandbox_123", provider: "sandbox" }),
    );
    const provider = new MisarMailProvider(API_KEY, "news@example.com", "News");

    await provider.send(message);
    await provider.send({ ...message, sandbox: true });

    const headers = vi.mocked(global.fetch).mock.calls.map(
      (call) => call[1]?.headers as Record<string, string>,
    );
    expect(headers[0]["X-MisarMail-Sandbox"]).toBeUndefined();
    expect(headers[1]["X-MisarMail-Sandbox"]).toBe("true");
    expect(sentBodies()[0]).toMatchObject({ idempotency_key: message.idempotencyKey });
    expect(sentBodies()[1]).toMatchObject({ idempotency_key: message.idempotencyKey });
  });

  it("keeps the queue on the stable recipient key", () => {
    const source = readFileSync(
      resolve("src/features/campaigns/queue-worker.ts"),
      "utf8",
    );
    expect(source).toContain("idempotencyKey: misarmailIdempotencyKey(recipient.id)");
    expect(source).not.toContain("sandbox:");
  });
});

describe("provider error wording", () => {
  it("keeps the existing Gmail quota and delivery messages", () => {
    expect(
      userFacingEmailError("quota_exceeded", "Gmail rate limit or quota was reached."),
    ).toBe("Gmail sending quota was reached. The campaign has been paused.");
    expect(
      userFacingEmailError(
        "delivery_unknown",
        "Gmail request outcome is unknown: socket hang up",
      ),
    ).toBe(
      "Gmail did not confirm whether this email was accepted. It was not retried to avoid sending a duplicate.",
    );
    expect(userFacingEmailError("auth_required")).toBe(
      "Your Gmail connection has expired. Please reconnect.",
    );
  });

  it("uses the MisarMail message when the failure is not a Gmail failure", () => {
    expect(
      userFacingEmailError(
        "quota_exceeded",
        "MisarMail plan limit was reached. The campaign has been paused.",
      ),
    ).toBe("MisarMail plan limit was reached. The campaign has been paused.");
    expect(
      userFacingEmailError(
        "invalid_recipient",
        "MisarMail suppressed this recipient and the send was not retried.",
      ),
    ).toBe("MisarMail suppressed this recipient and the send was not retried.");
  });
});
