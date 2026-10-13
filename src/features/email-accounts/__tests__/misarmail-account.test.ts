import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import {
  parseMisarMailAccountInput,
  saveMisarMailAccount,
} from "@/features/email-accounts/misarmail-account";
import {
  campaignSenderBlock,
  preferredSenderAccountId,
  selectableSenderAccounts,
} from "@/features/email-accounts/sender-eligibility";
import type { EmailAccountPublic } from "@/features/email-accounts/schemas";
import {
  misarmailTestIdempotencyKey,
  misarmailTestSendOptions,
} from "@/lib/email/providers/misarmail";

const API_KEY = "msk_unit_test_key";
const USER_ID = "user-1";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function remote(planStatus = 200, domains: unknown = [{ domain: "example.com", status: "verified" }]) {
  const urls: string[] = [];
  const methods: string[] = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(url));
    methods.push(init?.method ?? "GET");
    if (String(url).endsWith("/v1/plan-limits")) {
      return json(planStatus, {
        success: planStatus === 200,
        error: planStatus === 200 ? undefined : API_KEY,
      });
    }
    return json(200, { success: true, domains });
  };
  return { fetchImpl: fetchImpl as typeof fetch, urls, methods };
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

describe("MisarMail account connection", () => {
  const originalKey = process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  });

  afterEach(() => {
    process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY = originalKey;
  });

  it("encrypts the API key and does not store a refresh token", async () => {
    const network = remote();
    const user = client(async (call) => {
      if (call.op === "insert") return { data: { id: "account-misar" }, error: null };
      return { data: null, error: null };
    });
    const service = client(async () => ({ data: null, error: null }));

    const result = await saveMisarMailAccount(
      user as never,
      service as never,
      USER_ID,
      {
        email: "News@Example.com",
        displayName: "News",
        apiKey: API_KEY,
      },
      network.fetchImpl,
    );

    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(network.urls).toEqual([
      "https://api.misar.io/mail/v1/plan-limits",
      "https://api.misar.io/mail/domains",
    ]);
    expect(network.methods).toEqual(["GET", "GET"]);
    expect(network.urls.join(" ")).not.toContain("/v1/send");

    const accountInsert = user.calls.find((call) => call.op === "insert");
    expect(accountInsert?.payload).toMatchObject({
      user_id: USER_ID,
      provider: "misarmail",
      email: "news@example.com",
      display_name: "News",
      status: "connected",
    });
    expect(accountInsert?.filters).toEqual([]);

    const credentialInsert = service.calls.find((call) => call.op === "insert");
    const payload = credentialInsert?.payload as {
      encrypted_access_token: string;
      encrypted_refresh_token: string | null;
    };
    expect(decryptSecret(payload.encrypted_access_token)).toBe(API_KEY);
    expect(payload.encrypted_refresh_token).toBeNull();
    expect(JSON.stringify(payload)).not.toContain(API_KEY);
  });

  it("updates the sender without returning or replacing the saved key", async () => {
    const network = remote();
    const stored = encryptSecret(API_KEY);
    const user = client(async (call) => {
      if (call.op === "select") return { data: { id: "account-misar", provider: "misarmail" }, error: null };
      return { data: { id: "account-misar" }, error: null };
    });
    const service = client(async (call) => {
      if (call.op === "select") {
        return { data: { encrypted_access_token: stored }, error: null };
      }
      return { data: null, error: null };
    });

    const result = await saveMisarMailAccount(
      user as never,
      service as never,
      USER_ID,
      {
        accountId: "account-misar",
        email: "news@example.com",
        displayName: "Updated",
        apiKey: "",
      },
      network.fetchImpl,
    );

    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(service.calls.some((call) => call.op === "update")).toBe(false);
    expect(user.calls.some((call) => call.op === "update")).toBe(true);
    const ownerFilter = user.calls[0]?.filters;
    expect(ownerFilter).toContainEqual(["user_id", USER_ID]);
    expect(ownerFilter).toContainEqual(["id", "account-misar"]);
  });

  it("does not save an account when MisarMail rejects the key or the domain", async () => {
    const unauthorized = remote(401);
    const user = client(async () => ({ data: { id: "should-not" }, error: null }));
    const service = client(async () => ({ data: null, error: null }));

    const rejected = await saveMisarMailAccount(
      user as never,
      service as never,
      USER_ID,
      { email: "news@example.com", displayName: "News", apiKey: API_KEY },
      unauthorized.fetchImpl,
    );

    expect(rejected).toMatchObject({ ok: false, error: "MisarMail rejected this API key." });
    expect(JSON.stringify(rejected)).not.toContain(API_KEY);
    expect(unauthorized.urls).toEqual(["https://api.misar.io/mail/v1/plan-limits"]);
    expect(user.calls).toHaveLength(0);

    const unverified = remote(200, [{ domain: "example.com", status: "pending" }]);
    const blocked = await saveMisarMailAccount(
      user as never,
      service as never,
      USER_ID,
      { email: "news@example.com", displayName: "News", apiKey: API_KEY },
      unverified.fetchImpl,
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("verified MisarMail domain");
    expect(user.calls).toHaveLength(0);
  });

  it("does not edit an account owned by someone else", async () => {
    const network = remote();
    const user = client(async () => ({ data: null, error: null }));
    const service = client(async () => {
      throw new Error("credentials should not be read");
    });

    const result = await saveMisarMailAccount(
      user as never,
      service as never,
      USER_ID,
      {
        accountId: "other-account",
        email: "news@example.com",
        displayName: "News",
        apiKey: "",
      },
      network.fetchImpl,
    );

    expect(result).toEqual({ ok: false, error: "Email account not found." });
    expect(user.calls[0]?.filters).toContainEqual(["user_id", USER_ID]);
    expect(network.urls).toHaveLength(0);
    expect(service.calls).toHaveLength(0);
  });

  it("rejects an invalid key or email before any request", async () => {
    const parsed = parseMisarMailAccountInput(
      { email: "not-an-email", displayName: "News", apiKey: "secret-without-prefix" },
      { apiKeyRequired: true },
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(JSON.stringify(parsed)).not.toContain("secret-without-prefix");
  });
});

describe("sender selection", () => {
  const gmail = account({ id: "gmail-1", provider: "gmail" });
  const misar = account({
    id: "misar-1",
    provider: "misarmail",
    email: "news@example.com",
    display_name: "News",
  });

  it("offers connected Gmail and MisarMail accounts and keeps an existing Gmail campaign", () => {
    const accounts = [misar, gmail, account({ id: "old", provider: "outlook", status: "connected" })];
    expect(selectableSenderAccounts(accounts).map((item) => item.id)).toEqual([
      "misar-1",
      "gmail-1",
    ]);
    expect(preferredSenderAccountId(accounts, "gmail-1")).toBe("gmail-1");
    expect(preferredSenderAccountId(accounts, null)).toBe("gmail-1");
    expect(campaignSenderBlock({ provider: "gmail", status: "connected" })).toBeNull();
    expect(campaignSenderBlock(null)).toBe("Gmail is not connected.");
    expect(campaignSenderBlock({ provider: "gmail", status: "needs_reauth" })).toBe(
      "Your Gmail connection needs to be reauthorized.",
    );
    expect(campaignSenderBlock({ provider: "misarmail", status: "connected" })).toBeNull();
  });
});

describe("sandbox test send", () => {
  it("uses a stable sandbox key for MisarMail and leaves Gmail unchanged", () => {
    const first = misarmailTestSendOptions("misarmail", "account-1", "Ada@Example.com");
    const second = misarmailTestSendOptions("misarmail", "account-1", "ada@example.com");
    expect(first).toEqual(second);
    expect(first.sandbox).toBe(true);
    expect(first.idempotencyKey).toBe(
      misarmailTestIdempotencyKey("account-1", "ada@example.com"),
    );
    expect(first.idempotencyKey!.length).toBeLessThanOrEqual(128);
    expect(misarmailTestSendOptions("gmail", "account-1", "ada@example.com")).toEqual({});
  });
});
