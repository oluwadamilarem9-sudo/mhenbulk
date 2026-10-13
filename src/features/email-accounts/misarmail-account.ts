import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const PLAN_LIMITS_URL = "https://api.misar.io/mail/v1/plan-limits";
const DOMAINS_URL = "https://api.misar.io/mail/domains";
const CHECK_TIMEOUT_MS = 20_000;

type Client = SupabaseClient<Database>;

export type MisarMailAccountInput = {
  email: string;
  displayName: string;
  apiKey?: string;
  accountId?: string;
};

type SaveResult =
  | { ok: true }
  | SaveFailure;

type SaveFailure = { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function fixedKeyError(): SaveFailure {
  return { ok: false, error: "Enter a MisarMail API key.", fieldErrors: { apiKey: ["Enter a MisarMail API key."] } };
}

export function parseMisarMailAccountInput(
  input: MisarMailAccountInput,
  options: { apiKeyRequired: boolean },
):
  | { ok: true; email: string; displayName: string; apiKey: string }
  | SaveFailure {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const apiKey = input.apiKey?.trim() ?? "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return {
      ok: false,
      error: "Enter a valid sender email address.",
      fieldErrors: { email: ["Enter a valid sender email address."] },
    };
  }
  if (!displayName || displayName.length > 200) {
    return {
      ok: false,
      error: "Enter a sender display name.",
      fieldErrors: { displayName: ["Enter a sender display name."] },
    };
  }
  if (!apiKey) {
    if (options.apiKeyRequired) return fixedKeyError();
    return { ok: true, email, displayName, apiKey: "" };
  }
  if (!apiKey.startsWith("msk_") || apiKey.length > 200 || /\s/.test(apiKey)) {
    return fixedKeyError();
  }
  return { ok: true, email, displayName, apiKey };
}

type RemoteResult =
  | { ok: true; status: number; body: Record<string, unknown> | null }
  | { ok: false; error: string };

async function misarGet(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<RemoteResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    const text = await response.text();
    let body: Record<string, unknown> | null = null;
    if (text.trim()) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        body = null;
      }
    }
    return { ok: true, status: response.status, body };
  } catch {
    return {
      ok: false,
      error: "MisarMail could not be reached. The account was not saved.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function statusError(status: number): string {
  if (status === 401) return "MisarMail rejected this API key.";
  if (status === 403) {
    return "MisarMail refused this key because of a plan or permission restriction.";
  }
  if (status === 429) {
    return "MisarMail rate limit was reached. Wait and try the connection again.";
  }
  return "MisarMail could not verify this account. It was not saved.";
}

function senderDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

function domainIsAuthorized(
  domains: unknown,
  emailDomain: string,
): boolean {
  if (!Array.isArray(domains)) return false;
  return domains.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const row = entry as Record<string, unknown>;
    const domain = typeof row.domain === "string" ? row.domain.toLowerCase() : "";
    if (domain !== emailDomain) return false;
    return row.status === "verified" || row.is_platform_domain === true;
  });
}

/**
 * Confirms the key with GET /v1/plan-limits and the sender domain with
 * GET /domains. Neither call sends email. Each URL is requested once.
 */
export async function verifyMisarMailConnection(
  apiKey: string,
  senderEmail: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = await misarGet(PLAN_LIMITS_URL, apiKey, fetchImpl);
  if (!plan.ok) return plan;
  if (plan.status !== 200 || plan.body?.success !== true) {
    return { ok: false, error: statusError(plan.status) };
  }

  const domains = await misarGet(DOMAINS_URL, apiKey, fetchImpl);
  if (!domains.ok) return domains;
  if (domains.status !== 200 || domains.body?.success === false) {
    return { ok: false, error: statusError(domains.status) };
  }
  if (!domainIsAuthorized(domains.body?.domains, senderDomain(senderEmail))) {
    return {
      ok: false,
      error:
        "This sender address is not on a verified MisarMail domain. Use an address MisarMail has authorized.",
    };
  }
  return { ok: true };
}

export async function saveMisarMailAccount(
  userClient: Client,
  serviceClient: Client,
  userId: string,
  input: MisarMailAccountInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  const editing = Boolean(input.accountId);
  const parsed = parseMisarMailAccountInput(input, { apiKeyRequired: !editing });
  if (!parsed.ok) return parsed;

  let apiKey = parsed.apiKey;
  if (editing) {
    const { data: owned } = await userClient
      .from("email_accounts")
      .select("id, provider")
      .eq("id", input.accountId ?? "")
      .eq("user_id", userId)
      .eq("provider", "misarmail")
      .maybeSingle();

    if (!owned) return { ok: false, error: "Email account not found." };

    if (!apiKey) {
      const { data: credentials } = await serviceClient
        .from("email_account_credentials")
        .select("encrypted_access_token")
        .eq("email_account_id", owned.id)
        .maybeSingle();
      if (!credentials?.encrypted_access_token) {
        return { ok: false, error: "Enter a MisarMail API key." };
      }
      try {
        apiKey = decryptSecret(credentials.encrypted_access_token).trim();
      } catch {
        return {
          ok: false,
          error: "The saved MisarMail key could not be read. Enter a new API key.",
        };
      }
      if (!apiKey.startsWith("msk_")) {
        return { ok: false, error: "Enter a MisarMail API key." };
      }
    }
  }

  const verified = await verifyMisarMailConnection(apiKey, parsed.email, fetchImpl);
  if (!verified.ok) return verified;

  const encryptedAccessToken = encryptSecret(apiKey);

  if (!editing) {
    const { data: created, error: accountError } = await userClient
      .from("email_accounts")
      .insert({
        user_id: userId,
        provider: "misarmail",
        provider_account_id: parsed.email,
        email: parsed.email,
        display_name: parsed.displayName,
        status: "connected",
      })
      .select("id")
      .single();

    if (accountError || !created) {
      return { ok: false, error: accountSaveError(accountError?.code) };
    }

    const { error: credentialError } = await serviceClient
      .from("email_account_credentials")
      .insert({
        email_account_id: created.id,
        encrypted_access_token: encryptedAccessToken,
        encrypted_refresh_token: null,
        key_version: 1,
      });

    if (credentialError) {
      await userClient.from("email_accounts").delete().eq("id", created.id).eq("user_id", userId);
      return { ok: false, error: "The MisarMail key could not be stored. The account was not connected." };
    }
    return { ok: true };
  }

  if (parsed.apiKey) {
    const { error: credentialError } = await serviceClient
      .from("email_account_credentials")
      .update({ encrypted_access_token: encryptedAccessToken })
      .eq("email_account_id", input.accountId ?? "");
    if (credentialError) {
      return { ok: false, error: "The MisarMail key could not be stored. The account was not changed." };
    }
  }

  const { data: updated, error: updateError } = await userClient
    .from("email_accounts")
    .update({
      email: parsed.email,
      provider_account_id: parsed.email,
      display_name: parsed.displayName,
      status: "connected",
      last_error: null,
    })
    .eq("id", input.accountId ?? "")
    .eq("user_id", userId)
    .eq("provider", "misarmail")
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    return { ok: false, error: accountSaveError(updateError?.code) };
  }
  return { ok: true };
}

function accountSaveError(code: string | undefined): string {
  if (code === "23505") return "This MisarMail sender is already connected.";
  return "The MisarMail account could not be saved.";
}
