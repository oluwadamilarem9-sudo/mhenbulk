import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import {
  parseResendAccountInput,
  saveResendAccount,
} from "@/features/email-accounts/resend-account";
import {
  campaignSenderBlock,
  preferredSenderAccountId,
  selectableSenderAccounts,
} from "@/features/email-accounts/sender-eligibility";
import type { EmailAccountPublic } from "@/features/email-accounts/schemas";

const API_KEY = "re_unit_test_key";
const USER_ID = "user-1";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function remote(
  status = 200,
  domains: unknown = [{ name: "mhenbulk.store", status: "verified" }],
) {
  const urls: string[] = [];
  const fetchImpl = async (url: RequestInfo | URL) => {
    urls.push(String(url));
    return json(status, { object: "list", data: domains });
  };
  return { fetchImpl: fetchImpl as typeof fetch, urls };
}

type Call = {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
};

function client(
  respond: (call: Call) => Promise<{ data: unknown; error: { code?: string } | null }>,
) {
  const calls: Call[] = [];
  return {
    calls,
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      const chain = {
        insert(payload: unknown) {
          call.op = "insert";
          call.payload = payload;
          return chain;
        },
        update(payload: unknown) {
          call.op = "update";
          call.payload = payload;
          return chain;
        },
        delete() {
          call.op = "delete";
          return chain;
        },
        select() {
          return chain;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return chain;
        },
        single() {
          calls.push(call);
          return respond(call);
        },
        maybeSingle() {
          calls.push(call);
          return respond(call);
        },
        then(
          resolve: (value: { data: unknown; error: { code?: string } | null }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          calls.push(call);
          return respond(call).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

function account(overrides: Partial<EmailAccountPublic>): EmailAccountPublic {
  return {
    id: "account-gmail",
    provider: "gmail",
    email: "ada@gmail.example",
    display_name: "Ada",
    status: "connected",
    rate_limited_until: null,
    last_error: null,
    last_used_at: null,
    created_at: "2026-10-16T00:00:00.000Z",
    updated_at: "2026-10-16T00:00:00.000Z",
    daily_send_limit: null,
    today_sent_count: 0,
    last_count_reset_date: null,
    warmup_enabled: false,
    warmup_start_date: null,
    ...overrides,
  };
}

describe("Resend account connection", () => {
  const originalKey = process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  });

  afterEach(() => {
    process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY = originalKey;
  });

  it("encrypts the API key after verifying a Resend domain", async () => {
    const network = remote();
    const user = client(async (call) => {
      if (call.op === "insert") return { data: { id: "account-resend" }, error: null };
      return { data: null, error: null };
    });
    const service = client(async () => ({ data: null, error: null }));

    const result = await saveResendAccount(
      user as never,
      service as never,
      USER_ID,
      {
        email: "Hello@Mhenbulk.store",
        displayName: "Mhenbulk",
        apiKey: API_KEY,
      },
      network.fetchImpl,
    );

    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(network.urls).toEqual(["https://api.resend.com/domains"]);
    expect(network.urls.join(" ")).not.toContain("/emails");

    const accountInsert = user.calls.find((call) => call.op === "insert");
    expect(accountInsert?.payload).toMatchObject({
      user_id: USER_ID,
      provider: "resend",
      email: "hello@mhenbulk.store",
      status: "connected",
    });

    const credentialInsert = service.calls.find((call) => call.op === "insert");
    const payload = credentialInsert?.payload as {
      encrypted_access_token: string;
      encrypted_refresh_token: string | null;
    };
    expect(decryptSecret(payload.encrypted_access_token)).toBe(API_KEY);
    expect(payload.encrypted_refresh_token).toBeNull();
  });

  it("does not save when the key or domain fails verification", async () => {
    const unauthorized = remote(401);
    const user = client(async () => ({ data: { id: "should-not" }, error: null }));
    const service = client(async () => ({ data: null, error: null }));

    const rejected = await saveResendAccount(
      user as never,
      service as never,
      USER_ID,
      { email: "hello@mhenbulk.store", displayName: "Mhenbulk", apiKey: API_KEY },
      unauthorized.fetchImpl,
    );
    expect(rejected).toMatchObject({ ok: false, error: "Resend rejected this API key." });
    expect(user.calls).toHaveLength(0);

    const unverified = remote(200, [{ name: "mhenbulk.store", status: "pending" }]);
    const blocked = await saveResendAccount(
      user as never,
      service as never,
      USER_ID,
      { email: "hello@mhenbulk.store", displayName: "Mhenbulk", apiKey: API_KEY },
      unverified.fetchImpl,
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("verified Resend domain");
  });

  it("keeps a saved key hidden when editing the sender", async () => {
    const network = remote();
    const stored = encryptSecret(API_KEY);
    const user = client(async (call) => {
      if (call.op === "select") {
        return { data: { id: "account-resend", provider: "resend" }, error: null };
      }
      return { data: { id: "account-resend" }, error: null };
    });
    const service = client(async (call) => {
      if (call.op === "select") {
        return { data: { encrypted_access_token: stored }, error: null };
      }
      return { data: null, error: null };
    });

    const result = await saveResendAccount(
      user as never,
      service as never,
      USER_ID,
      {
        accountId: "account-resend",
        email: "hello@mhenbulk.store",
        displayName: "Updated",
        apiKey: "",
      },
      network.fetchImpl,
    );

    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(service.calls.some((call) => call.op === "update")).toBe(false);
  });

  it("rejects a non-Resend key before calling the API", () => {
    const parsed = parseResendAccountInput(
      { email: "hello@mhenbulk.store", displayName: "Mhenbulk", apiKey: "msk_wrong" },
      { apiKeyRequired: true },
    );
    expect(parsed.ok).toBe(false);
  });
});

describe("Resend sender selection", () => {
  it("offers Resend alongside Gmail and MisarMail", () => {
    const accounts = [
      account({ id: "resend-1", provider: "resend", email: "hello@mhenbulk.store" }),
      account({ id: "gmail-1", provider: "gmail" }),
      account({ id: "misar-1", provider: "misarmail", email: "news@example.com" }),
    ];
    expect(selectableSenderAccounts(accounts).map((item) => item.id)).toEqual([
      "resend-1",
      "gmail-1",
      "misar-1",
    ]);
    expect(preferredSenderAccountId(accounts, null)).toBe("gmail-1");
    expect(preferredSenderAccountId(accounts, "resend-1")).toBe("resend-1");
    expect(campaignSenderBlock({ provider: "resend", status: "connected" })).toBeNull();
    expect(campaignSenderBlock({ provider: "resend", status: "needs_reauth" })).toBe(
      "Resend is not connected.",
    );
  });
});
