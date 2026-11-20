import { afterEach, describe, expect, it, vi } from "vitest";

import { GmailProvider } from "@/lib/email/providers/gmail";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("GmailProvider send-as From header", () => {
  it("uses the selected alias in the MIME From header", async () => {
    vi.stubEnv("GMAIL_SEND_TIMEOUT_MS", "5000");
    let rawBody = "";
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { raw?: string };
      const b64 = (payload.raw ?? "")
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      rawBody = Buffer.from(padded, "base64").toString("utf8");
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "msg-1", threadId: "thread-1" }),
        headers: new Headers(),
        text: async () => "",
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GmailProvider(
      "token",
      "aisunnyvid@gmail.com",
      "Primary Name",
    );
    const result = await provider.send({
      to: "lead@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
      from: "info@mhenexpert.com",
      fromName: "MHEN Expert",
      replyTo: "info@mhenexpert.com",
    });

    expect(result.success).toBe(true);
    expect(rawBody).toContain('From: "MHEN Expert" <info@mhenexpert.com>');
    expect(rawBody).toContain("Reply-To: info@mhenexpert.com");
    expect(rawBody).not.toContain("aisunnyvid@gmail.com");
  });

  it("preserves primary Gmail sending when no alias override is provided", async () => {
    vi.stubEnv("GMAIL_SEND_TIMEOUT_MS", "5000");
    let rawBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body ?? "{}")) as { raw?: string };
        const b64 = (payload.raw ?? "")
          .replace(/-/g, "+")
          .replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        rawBody = Buffer.from(padded, "base64").toString("utf8");
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "msg-2" }),
          headers: new Headers(),
          text: async () => "",
        };
      }),
    );

    const provider = new GmailProvider("token", "aisunnyvid@gmail.com", "Sunny");
    await provider.send({
      to: "lead@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
    });

    expect(rawBody).toContain('From: "Sunny" <aisunnyvid@gmail.com>');
  });
});
