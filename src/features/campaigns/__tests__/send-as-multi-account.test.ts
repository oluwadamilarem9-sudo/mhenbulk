import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "@/lib/crypto/secrets";

const refreshMock = vi.fn();

vi.mock("@/lib/google/oauth", () => ({
  GoogleTokenRefreshError: class GoogleTokenRefreshError extends Error {
    kind: "transient" | "permanent";
    constructor(message: string, kind: "transient" | "permanent" = "permanent") {
      super(message);
      this.kind = kind;
    }
  },
  refreshGoogleAccessTokenWithRetry: (...args: unknown[]) => refreshMock(...args),
}));

import {
  listSendAsForAccount,
  resolveSenderForQueuedCampaign,
  resolveVerifiedCampaignSender,
} from "@/features/campaigns/send-as";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type AccountRow = {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  status: string;
  provider: string;
  scopes: string[];
  token_expiry: string | null;
  preferred_send_as_email: string | null;
};

function gmailAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: ACCOUNT_A,
    user_id: USER_ID,
    email: "aisunnyvid@gmail.com",
    display_name: "Sunny",
    status: "connected",
    provider: "gmail",
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    token_expiry: new Date(Date.now() + 3_600_000).toISOString(),
    preferred_send_as_email: null,
    ...overrides,
  };
}

function createSupabaseMock(options: {
  accounts: Record<string, AccountRow>;
  cacheInsertError?: string | null;
  deletedCacheFor?: string[];
}) {
  const deletedCacheFor = options.deletedCacheFor ?? [];
  const insertedByAccount: Record<string, unknown[]> = {};
  const updates: Array<{ table: string; payload: unknown }> = [];

  const client = {
    from(table: string) {
      if (table === "email_accounts") {
        let accountId: string | null = null;
        let userId: string | null = null;
        const chain: {
          select: () => typeof chain;
          eq: (column: string, value: string) => typeof chain;
          update: (payload: unknown) => typeof chain;
          maybeSingle: () => Promise<{ data: AccountRow | null; error: null }>;
          then: (
            resolve: (value: { data: null; error: null }) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise<unknown>;
        } = {
          select() {
            return chain;
          },
          eq(column: string, value: string) {
            if (column === "id") accountId = value;
            if (column === "user_id") userId = value;
            return chain;
          },
          update(payload: unknown) {
            updates.push({ table, payload });
            return chain;
          },
          maybeSingle: async () => {
            const account = accountId ? options.accounts[accountId] : null;
            if (!account || (userId && account.user_id !== userId)) {
              return { data: null, error: null };
            }
            return { data: account, error: null };
          },
          then(resolve, reject) {
            return Promise.resolve({ data: null, error: null }).then(
              resolve,
              reject,
            );
          },
        };
        return chain;
      }

      if (table === "email_account_credentials") {
        let accountId: string | null = null;
        const chain: {
          select: () => typeof chain;
          eq: (column: string, value: string) => typeof chain;
          update: (payload: unknown) => typeof chain;
          maybeSingle: () => Promise<{
            data: {
              encrypted_access_token: string;
              encrypted_refresh_token: string;
            } | null;
            error: null;
          }>;
          then: (
            resolve: (value: { data: null; error: null }) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise<unknown>;
        } = {
          select() {
            return chain;
          },
          eq(column: string, value: string) {
            if (column === "email_account_id") accountId = value;
            return chain;
          },
          update(payload: unknown) {
            updates.push({ table, payload });
            return chain;
          },
          maybeSingle: async () => {
            if (!accountId || !options.accounts[accountId]) {
              return { data: null, error: null };
            }
            // Distinct tokens per account — never shared across accounts.
            return {
              data: {
                encrypted_access_token: encryptSecret(`access-${accountId}`),
                encrypted_refresh_token: encryptSecret(`refresh-${accountId}`),
              },
              error: null,
            };
          },
          then(resolve, reject) {
            return Promise.resolve({ data: null, error: null }).then(
              resolve,
              reject,
            );
          },
        };
        return chain;
      }

      if (table === "email_account_send_as") {
        let accountId: string | null = null;
        let userId: string | null = null;
        const chain: {
          delete: () => typeof chain;
          eq: (column: string, value: string) => typeof chain;
          insert: (
            rows: unknown[],
          ) => Promise<{ error: { message: string } | null }>;
          then: (
            resolve: (value: { error: null }) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => Promise<unknown>;
        } = {
          delete() {
            return chain;
          },
          eq(column: string, value: string) {
            if (column === "email_account_id") accountId = value;
            if (column === "user_id") userId = value;
            return chain;
          },
          insert: async (rows: unknown[]) => {
            if (options.cacheInsertError) {
              return { error: { message: options.cacheInsertError } };
            }
            const rowAccountId =
              accountId ??
              (Array.isArray(rows) && rows[0]
                ? (rows[0] as { email_account_id?: string }).email_account_id
                : null);
            if (rowAccountId) {
              insertedByAccount[rowAccountId] = rows;
            }
            return { error: null };
          },
          then(resolve, reject) {
            if (accountId) deletedCacheFor.push(accountId);
            void userId;
            return Promise.resolve({ error: null }).then(resolve, reject);
          },
        };
        return chain;
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };

  return { client, insertedByAccount, deletedCacheFor, updates };
}

describe("multi-account Gmail send-as loading", () => {
  const originalKey = process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString(
      "base64",
    );
    refreshMock.mockReset();
    refreshMock.mockImplementation(async (refreshToken: string) => ({
      access_token: `refreshed-${refreshToken}`,
      refresh_token: refreshToken,
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/gmail.modify",
      token_type: "Bearer",
    }));
  });

  afterEach(() => {
    process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY = originalKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads Account A primary + verified info@mhenexpert.com with that account token only", async () => {
    const { client, insertedByAccount } = createSupabaseMock({
      accounts: {
        [ACCOUNT_A]: gmailAccount(),
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sendAs: [
          {
            sendAsEmail: "aisunnyvid@gmail.com",
            displayName: "Sunny",
            isPrimary: true,
            isDefault: true,
          },
          {
            sendAsEmail: "info@mhenexpert.com",
            displayName: "MHEN Expert",
            verificationStatus: "accepted",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listSendAsForAccount(
      client as never,
      USER_ID,
      ACCOUNT_A,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accountEmail).toBe("aisunnyvid@gmail.com");
    expect(result.aliases.map((alias) => alias.email)).toEqual([
      "aisunnyvid@gmail.com",
      "info@mhenexpert.com",
    ]);
    expect(result.diagnostics.httpStatus).toBe(200);
    expect(result.diagnostics.returnedCount).toBe(2);
    expect(result.diagnostics.usableCount).toBe(2);
    expect(insertedByAccount[ACCOUNT_A]).toHaveLength(2);

    const authHeader = (
      fetchMock.mock.calls[0]?.[1] as { headers?: { Authorization?: string } }
    )?.headers?.Authorization;
    expect(authHeader).toBe(`Bearer refreshed-refresh-${ACCOUNT_A}`);
    expect(authHeader).not.toContain(ACCOUNT_B);
  });

  it("switches accounts without mixing aliases", async () => {
    const { client } = createSupabaseMock({
      accounts: {
        [ACCOUNT_A]: gmailAccount({ id: ACCOUNT_A, email: "aisunnyvid@gmail.com" }),
        [ACCOUNT_B]: gmailAccount({
          id: ACCOUNT_B,
          email: "other@gmail.com",
          display_name: "Other",
        }),
      },
    });

    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const auth = String(
        (init?.headers as Record<string, string> | undefined)?.Authorization ??
          "",
      );
      if (auth.includes(ACCOUNT_A)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sendAs: [
              {
                sendAsEmail: "aisunnyvid@gmail.com",
                isPrimary: true,
                isDefault: true,
              },
              {
                sendAsEmail: "info@mhenexpert.com",
                verificationStatus: "accepted",
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sendAs: [
            {
              sendAsEmail: "other@gmail.com",
              isPrimary: true,
              isDefault: true,
            },
            {
              sendAsEmail: "billing@otherdomain.com",
              verificationStatus: "accepted",
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const listA = await listSendAsForAccount(client as never, USER_ID, ACCOUNT_A);
    const listB = await listSendAsForAccount(client as never, USER_ID, ACCOUNT_B);

    expect(listA.ok && listA.aliases.map((a) => a.email)).toEqual([
      "aisunnyvid@gmail.com",
      "info@mhenexpert.com",
    ]);
    expect(listB.ok && listB.aliases.map((a) => a.email)).toEqual([
      "other@gmail.com",
      "billing@otherdomain.com",
    ]);
    if (listB.ok) {
      expect(
        listB.aliases.some((alias) => alias.email === "info@mhenexpert.com"),
      ).toBe(false);
    }
  });

  it("still returns live aliases when cache persistence fails (stale/missing table)", async () => {
    const { client } = createSupabaseMock({
      accounts: { [ACCOUNT_A]: gmailAccount() },
      cacheInsertError: "relation \"email_account_send_as\" does not exist",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          sendAs: [
            {
              sendAsEmail: "aisunnyvid@gmail.com",
              isPrimary: true,
              isDefault: true,
            },
            {
              sendAsEmail: "info@mhenexpert.com",
              verificationStatus: "accepted",
            },
          ],
        }),
      }),
    );

    const result = await listSendAsForAccount(
      client as never,
      USER_ID,
      ACCOUNT_A,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aliases.map((alias) => alias.email)).toContain(
      "info@mhenexpert.com",
    );
    expect(result.warning).toMatch(/Alias cache could not be saved/i);
    expect(result.warning).toMatch(/0024/);
  });

  it("exposes pending aliases in inventory but not as selectable senders", async () => {
    const { client } = createSupabaseMock({
      accounts: { [ACCOUNT_A]: gmailAccount() },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          sendAs: [
            {
              sendAsEmail: "aisunnyvid@gmail.com",
              isPrimary: true,
              isDefault: true,
            },
            {
              sendAsEmail: "info@mhenexpert.com",
              verificationStatus: "pending",
            },
          ],
        }),
      }),
    );

    const result = await listSendAsForAccount(
      client as never,
      USER_ID,
      ACCOUNT_A,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aliases.map((alias) => alias.email)).toEqual([
      "aisunnyvid@gmail.com",
    ]);
    expect(
      result.inventory.find((item) => item.email === "info@mhenexpert.com"),
    ).toMatchObject({
      usable: false,
      statusLabel: "Verification pending in Gmail",
    });
    expect(result.warning).toMatch(/not verified for sending/i);

    const rejected = await resolveVerifiedCampaignSender(
      client as never,
      USER_ID,
      ACCOUNT_A,
      "info@mhenexpert.com",
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error).toMatch(/Verification pending/i);
    }
  });

  it("handles Gmail API forbidden without inventing aliases", async () => {
    const { client } = createSupabaseMock({
      accounts: { [ACCOUNT_A]: gmailAccount({ scopes: ["https://www.googleapis.com/auth/gmail.send"] }) },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({ error: { message: "Insufficient Permission" } }),
      }),
    );

    const result = await listSendAsForAccount(
      client as never,
      USER_ID,
      ACCOUNT_A,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aliases.map((alias) => alias.email)).toEqual([
      "aisunnyvid@gmail.com",
    ]);
    expect(result.aliasesAvailable).toBe(false);
    expect(result.diagnostics.httpStatus).toBe(403);
    expect(result.warning).toMatch(/gmail\.modify|send-as listing/i);
  });

  it("preserves queued campaign sending for a verified alias", async () => {
    const { client } = createSupabaseMock({
      accounts: { [ACCOUNT_A]: gmailAccount() },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          sendAs: [
            {
              sendAsEmail: "aisunnyvid@gmail.com",
              isPrimary: true,
              isDefault: true,
            },
            {
              sendAsEmail: "info@mhenexpert.com",
              displayName: "MHEN Expert",
              replyToAddress: "info@mhenexpert.com",
              verificationStatus: "accepted",
            },
          ],
        }),
      }),
    );

    const queued = await resolveSenderForQueuedCampaign(
      client as never,
      USER_ID,
      ACCOUNT_A,
      "info@mhenexpert.com",
      "Campaign Name",
      null,
    );
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    expect(queued.fromEmail).toBe("info@mhenexpert.com");
    expect(queued.fromName).toBe("Campaign Name");
    expect(queued.replyToEmail).toBe("info@mhenexpert.com");
  });

  it("rejects unverified aliases at queue time instead of falling back to primary", async () => {
    const { client } = createSupabaseMock({
      accounts: { [ACCOUNT_A]: gmailAccount() },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          sendAs: [
            {
              sendAsEmail: "aisunnyvid@gmail.com",
              isPrimary: true,
              isDefault: true,
            },
            {
              sendAsEmail: "info@mhenexpert.com",
              verificationStatus: "pending",
            },
          ],
        }),
      }),
    );

    const queued = await resolveSenderForQueuedCampaign(
      client as never,
      USER_ID,
      ACCOUNT_A,
      "info@mhenexpert.com",
      null,
      null,
    );
    expect(queued.ok).toBe(false);
    if (!queued.ok) {
      expect(queued.code).toBe("invalid_from");
      expect(queued.retryable).toBe(false);
      expect(queued.error).not.toMatch(/aisunnyvid@gmail.com/);
    }
  });

  it("continues listing even when stored scopes omit modify (DB lag after reconnect)", async () => {
    const { client } = createSupabaseMock({
      accounts: {
        [ACCOUNT_A]: gmailAccount({
          scopes: ["https://www.googleapis.com/auth/gmail.send"],
        }),
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          sendAs: [
            {
              sendAsEmail: "aisunnyvid@gmail.com",
              isPrimary: true,
              isDefault: true,
            },
            {
              sendAsEmail: "info@mhenexpert.com",
              verificationStatus: "accepted",
            },
          ],
        }),
      }),
    );

    const result = await listSendAsForAccount(
      client as never,
      USER_ID,
      ACCOUNT_A,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.hasListScopeInDb).toBe(false);
    expect(result.aliases.map((alias) => alias.email)).toContain(
      "info@mhenexpert.com",
    );
    expect(result.warning).toMatch(/Stored OAuth scopes/i);
  });
});
