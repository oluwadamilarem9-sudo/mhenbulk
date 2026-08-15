import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { GmailProvider } from "@/lib/email/providers/gmail";
import { OutlookProvider } from "@/lib/email/providers/outlook-stub";
import type { EmailProvider } from "@/lib/email/types";
import { refreshGoogleAccessToken } from "@/lib/google/oauth";
import type { Database } from "@/lib/supabase/database.types";

type AppSupabaseClient = SupabaseClient<Database>;

const ACCESS_TOKEN_SKEW_MS = 60_000;

export type ResolvedAccountProvider = {
  provider: EmailProvider;
  accountId: string;
  email: string;
  displayName: string | null;
  accountStatus: Database["public"]["Enums"]["email_account_status"];
};

/**
 * Loads a connected email account, refreshes OAuth tokens when needed,
 * and returns a ready-to-use provider instance.
 *
 * Credentials are read via the provided client (typically service-role).
 */
export async function resolveEmailProviderForAccount(
  supabase: AppSupabaseClient,
  userId: string,
  emailAccountId: string,
): Promise<
  | { ok: true; value: ResolvedAccountProvider }
  | { ok: false; error: string; code: "not_found" | "auth_required" | "rate_limited" | "unsupported" }
> {
  const { data: account } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", emailAccountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!account) {
    return { ok: false, error: "Gmail is not connected.", code: "not_found" };
  }

  if (account.status === "disconnected") {
    return {
      ok: false,
      error: "Gmail is not connected.",
      code: "auth_required",
    };
  }

  if (account.status === "needs_reauth") {
    return {
      ok: false,
      error: "Your Gmail connection needs to be reauthorized.",
      code: "auth_required",
    };
  }

  if (
    account.status === "rate_limited" &&
    account.rate_limited_until &&
    new Date(account.rate_limited_until).getTime() > Date.now()
  ) {
    return {
      ok: false,
      error: "Gmail sending quota was reached. The campaign has been paused.",
      code: "rate_limited",
    };
  }

  if (account.provider === "outlook") {
    return {
      ok: false,
      error: "Outlook sending is not implemented yet.",
      code: "unsupported",
    };
  }

  if (account.provider !== "gmail") {
    return {
      ok: false,
      error: "Unsupported email provider for this account.",
      code: "unsupported",
    };
  }

  const { data: credentials } = await supabase
    .from("email_account_credentials")
    .select("*")
    .eq("email_account_id", account.id)
    .maybeSingle();

  if (!credentials) {
    await supabase
      .from("email_accounts")
      .update({
        status: "needs_reauth",
        last_error: "Missing OAuth credentials",
      })
      .eq("id", account.id);

    return {
      ok: false,
      error: "Your Gmail connection needs to be reauthorized.",
      code: "auth_required",
    };
  }

  let accessToken = decryptSecret(credentials.encrypted_access_token);
  const refreshToken = decryptSecret(credentials.encrypted_refresh_token);
  const expiresAt = account.token_expiry
    ? new Date(account.token_expiry).getTime()
    : 0;

  if (!expiresAt || expiresAt - ACCESS_TOKEN_SKEW_MS <= Date.now()) {
    try {
      const refreshed = await refreshGoogleAccessToken(refreshToken);
      accessToken = refreshed.access_token;

      await supabase
        .from("email_account_credentials")
        .update({
          encrypted_access_token: encryptSecret(refreshed.access_token),
          encrypted_refresh_token: encryptSecret(
            refreshed.refresh_token || refreshToken,
          ),
        })
        .eq("email_account_id", account.id);

      await supabase
        .from("email_accounts")
        .update({
          status: "connected",
          token_expiry: new Date(
            Date.now() + refreshed.expires_in * 1000,
          ).toISOString(),
          last_error: null,
        })
        .eq("id", account.id);
    } catch (error) {
      console.error("[gmail] token refresh failed", error);
      await supabase
        .from("email_accounts")
        .update({
          status: "needs_reauth",
          last_error: "Token refresh failed",
        })
        .eq("id", account.id);

      return {
        ok: false,
        error: "Your Gmail connection needs to be reauthorized.",
        code: "auth_required",
      };
    }
  }

  return {
    ok: true,
    value: {
      provider: new GmailProvider(
        accessToken,
        account.email,
        account.display_name,
      ),
      accountId: account.id,
      email: account.email,
      displayName: account.display_name,
      accountStatus: account.status,
    },
  };
}

export { OutlookProvider };
