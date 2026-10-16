import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "@/lib/crypto/secrets";
import { GmailProvider } from "@/lib/email/providers/gmail";
import { MisarMailProvider } from "@/lib/email/providers/misarmail";
import { ResendProvider } from "@/lib/email/providers/resend";
import { resolveEmailProviderForAccount } from "@/lib/email/resolve-provider";

const API_KEY = "msk_unit_test_key";

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "account-1",
    user_id: "user-1",
    provider: "gmail",
    provider_account_id: "google-sub",
    email: "sender@example.com",
    display_name: "Sender",
    status: "connected",
    scopes: [],
    token_expiry: new Date(Date.now() + 60 * 60_000).toISOString(),
    rate_limited_until: null,
    last_error: null,
    last_used_at: null,
    created_at: "2026-10-12T00:00:00.000Z",
    updated_at: "2026-10-12T00:00:00.000Z",
    daily_send_limit: null,
    today_sent_count: 0,
    last_count_reset_date: null,
    warmup_enabled: false,
    warmup_start_date: null,
    ...overrides,
  };
}

function supabaseFor(tables: Record<string, unknown>, updates: Array<{ table: string; payload: unknown }> = []) {
  return {
    from(table: string) {
      const promise = Promise.resolve({ data: tables[table] ?? null, error: null });
      const chain = {
        select() {
          return chain;
        },
        eq() {
          return chain;
        },
        update(payload: unknown) {
          updates.push({ table, payload });
          return chain;
        },
        maybeSingle() {
          return promise;
        },
        then: promise.then.bind(promise),
      };
      return chain;
    },
  };
}

describe("resolveEmailProviderForAccount", () => {
  const originalKey = process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    global.fetch = vi.fn() as typeof fetch;
  });

  afterEach(() => {
    process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY = originalKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("still resolves a connected Gmail account to GmailProvider", async () => {
    const client = supabaseFor({
      email_accounts: account(),
      email_account_credentials: {
        encrypted_access_token: encryptSecret("gmail-access-token"),
        encrypted_refresh_token: encryptSecret("gmail-refresh-token"),
      },
    });

    const resolved = await resolveEmailProviderForAccount(
      client as never,
      "user-1",
      "account-1",
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.provider).toBeInstanceOf(GmailProvider);
    expect(resolved.value.provider.name).toBe("gmail");
    expect(resolved.value.email).toBe("sender@example.com");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("still rejects Outlook and other non-Gmail providers", async () => {
    const outlook = await resolveEmailProviderForAccount(
      supabaseFor({ email_accounts: account({ provider: "outlook" }) }) as never,
      "user-1",
      "account-1",
    );
    const smtp = await resolveEmailProviderForAccount(
      supabaseFor({ email_accounts: account({ provider: "smtp" }) }) as never,
      "user-1",
      "account-1",
    );

    expect(outlook).toMatchObject({ ok: false, code: "unsupported" });
    expect(smtp).toMatchObject({
      ok: false,
      code: "unsupported",
      error: "Unsupported email provider for this account.",
    });
  });

  it("resolves a MisarMail account from the encrypted API key", async () => {
    const client = supabaseFor({
      email_accounts: account({
        provider: "misarmail",
        provider_account_id: "news@example.com",
        email: "news@example.com",
        display_name: "News",
      }),
      email_account_credentials: {
        encrypted_access_token: encryptSecret(API_KEY),
        encrypted_refresh_token: encryptSecret("unused"),
      },
    });
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ success: true, message_id: "msg_1" }), {
        status: 200,
      }),
    );

    const resolved = await resolveEmailProviderForAccount(
      client as never,
      "user-1",
      "account-1",
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.provider).toBeInstanceOf(MisarMailProvider);
    expect(resolved.value.email).toBe("news@example.com");
    expect(resolved.value.displayName).toBe("News");

    await resolved.value.provider.send({
      to: "ada@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
      idempotencyKey: "mhenbulk:recipient-1",
    });

    const init = vi.mocked(global.fetch).mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${API_KEY}`,
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: { email: "news@example.com", name: "News" },
    });
  });

  it("does not send when the stored MisarMail key is missing or unreadable", async () => {
    const updates: Array<{ table: string; payload: unknown }> = [];
    const missing = await resolveEmailProviderForAccount(
      supabaseFor(
        {
          email_accounts: account({ provider: "misarmail", email: "news@example.com" }),
          email_account_credentials: null,
        },
        updates,
      ) as never,
      "user-1",
      "account-1",
    );
    const invalid = await resolveEmailProviderForAccount(
      supabaseFor({
        email_accounts: account({ provider: "misarmail", email: "news@example.com" }),
        email_account_credentials: {
          encrypted_access_token: "not-encrypted",
          encrypted_refresh_token: "not-encrypted",
        },
      }) as never,
      "user-1",
      "account-1",
    );
    const blank = await resolveEmailProviderForAccount(
      supabaseFor({
        email_accounts: account({ provider: "misarmail", email: "news@example.com" }),
        email_account_credentials: {
          encrypted_access_token: encryptSecret("   "),
          encrypted_refresh_token: encryptSecret("unused"),
        },
      }) as never,
      "user-1",
      "account-1",
    );

    expect(missing).toMatchObject({ ok: false, code: "auth_required" });
    expect(invalid).toMatchObject({ ok: false, code: "auth_required" });
    expect(blank).toMatchObject({ ok: false, code: "auth_required" });
    expect(updates[0]?.payload).toMatchObject({ status: "needs_reauth" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("resolves a Resend account from the encrypted API key", async () => {
    const client = supabaseFor({
      email_accounts: account({
        provider: "resend",
        provider_account_id: "hello@mhenbulk.store",
        email: "hello@mhenbulk.store",
        display_name: "Mhenbulk",
      }),
      email_account_credentials: {
        encrypted_access_token: encryptSecret("re_unit_test_key"),
        encrypted_refresh_token: null,
      },
    });

    const resolved = await resolveEmailProviderForAccount(
      client as never,
      "user-1",
      "account-1",
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.provider).toBeInstanceOf(ResendProvider);
    expect(resolved.value.email).toBe("hello@mhenbulk.store");
  });

  it("does not treat a MisarMail account as Gmail when the refresh token is empty", async () => {
    const resolved = await resolveEmailProviderForAccount(
      supabaseFor({
        email_accounts: account(),
        email_account_credentials: {
          encrypted_access_token: encryptSecret("gmail-access-token"),
          encrypted_refresh_token: null,
        },
      }) as never,
      "user-1",
      "account-1",
    );

    expect(resolved).toMatchObject({
      ok: false,
      code: "auth_required",
      error: "Your Gmail connection needs to be reauthorized.",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
