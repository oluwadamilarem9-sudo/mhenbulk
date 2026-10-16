import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

const DOMAINS_URL = "https://api.resend.com/domains";
const CHECK_TIMEOUT_MS = 20_000;

type Client = SupabaseClient<Database>;

export type ResendAccountInput = {
  email: string;
  displayName: string;
  apiKey?: string;
  accountId?: string;
};

type SaveFailure = { ok: false; error: string; fieldErrors?: Record<string, string[]> };
type SaveResult = { ok: true } | SaveFailure;

function fixedKeyError(): SaveFailure {
  return {
    ok: false,
    error: "Enter a Resend API key.",
    fieldErrors: { apiKey: ["Enter a Resend API key."] },
  };
}

export function parseResendAccountInput(
  input: ResendAccountInput,
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
  if (!apiKey.startsWith("re_") || apiKey.length > 200 || /\s/.test(apiKey)) {
    return fixedKeyError();
  }
  return { ok: true, email, displayName, apiKey };
}

function senderDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

function domainIsVerified(domains: unknown, emailDomain: string): boolean {
  if (!Array.isArray(domains)) return false;
  return domains.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.toLowerCase() : "";
    if (name !== emailDomain) return false;
    return row.status === "verified";
  });
}

function statusError(status: number): string {
  if (status === 401) return "Resend rejected this API key.";
  if (status === 403) {
    return "Resend refused this key because of a permission restriction.";
  }
  if (status === 429) {
    return "Resend rate limit was reached. Wait and try the connection again.";
  }
  return "Resend could not verify this account. It was not saved.";
}

/**
 * Confirms the key and that the sender domain is verified in Resend.
 * GET /domains does not send email.
 */
export async function verifyResendConnection(
  apiKey: string,
  senderEmail: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetchImpl(DOMAINS_URL, {
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

    if (response.status !== 200) {
      return { ok: false, error: statusError(response.status) };
    }
    if (!domainIsVerified(body?.data, senderDomain(senderEmail))) {
      return {
        ok: false,
        error:
          "This sender address is not on a verified Resend domain. Verify the domain in Resend first.",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Resend could not be reached. The account was not saved.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveResendAccount(
  userClient: Client,
  serviceClient: Client,
  userId: string,
  input: ResendAccountInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SaveResult> {
  const editing = Boolean(input.accountId);
  const parsed = parseResendAccountInput(input, { apiKeyRequired: !editing });
  if (!parsed.ok) return parsed;

  let apiKey = parsed.apiKey;
  if (editing) {
    const { data: owned } = await userClient
      .from("email_accounts")
      .select("id, provider")
      .eq("id", input.accountId ?? "")
      .eq("user_id", userId)
      .eq("provider", "resend")
      .maybeSingle();

    if (!owned) return { ok: false, error: "Email account not found." };

    if (!apiKey) {
      const { data: credentials } = await serviceClient
        .from("email_account_credentials")
        .select("encrypted_access_token")
        .eq("email_account_id", owned.id)
        .maybeSingle();
      if (!credentials?.encrypted_access_token) {
        return { ok: false, error: "Enter a Resend API key." };
      }
      try {
        apiKey = decryptSecret(credentials.encrypted_access_token).trim();
      } catch {
        return {
          ok: false,
          error: "The saved Resend key could not be read. Enter a new API key.",
        };
      }
      if (!apiKey.startsWith("re_")) {
        return { ok: false, error: "Enter a Resend API key." };
      }
    }
  }

  const verified = await verifyResendConnection(apiKey, parsed.email, fetchImpl);
  if (!verified.ok) return verified;

  const encryptedAccessToken = encryptSecret(apiKey);

  if (!editing) {
    const { data: created, error: accountError } = await userClient
      .from("email_accounts")
      .insert({
        user_id: userId,
        provider: "resend",
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
      return {
        ok: false,
        error: "The Resend key could not be stored. The account was not connected.",
      };
    }
    return { ok: true };
  }

  if (parsed.apiKey) {
    const { error: credentialError } = await serviceClient
      .from("email_account_credentials")
      .update({ encrypted_access_token: encryptedAccessToken })
      .eq("email_account_id", input.accountId ?? "");
    if (credentialError) {
      return {
        ok: false,
        error: "The Resend key could not be stored. The account was not changed.",
      };
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
    .eq("provider", "resend")
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    return { ok: false, error: accountSaveError(updateError?.code) };
  }
  return { ok: true };
}

function accountSaveError(code: string | undefined): string {
  if (code === "23505") return "This Resend sender is already connected.";
  return "The Resend account could not be saved.";
}
