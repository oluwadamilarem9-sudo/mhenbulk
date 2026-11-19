import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import {
  GoogleTokenRefreshError,
  refreshGoogleAccessTokenWithRetry,
} from "@/lib/google/oauth";
import { hasGmailModifyScope, mergeGoogleScopes } from "@/lib/google/scopes";
import type { Database } from "@/lib/supabase/database.types";

type AppSupabaseClient = SupabaseClient<Database>;

const ACCESS_TOKEN_SKEW_MS = 60_000;

export type GmailMailboxAccess =
  | {
      ok: true;
      accountId: string;
      email: string;
      displayName: string | null;
      accessToken: string;
      scopes: string[];
    }
  | {
      ok: false;
      code:
        | "not_found"
        | "auth_required"
        | "missing_modify_scope"
        | "unsupported"
        | "transient";
      error: string;
    };

/**
 * Resolves a user-owned Gmail account for mailbox read/modify operations.
 * Reuses encrypted credential storage and refresh logic from sending.
 */
export async function resolveGmailMailboxAccess(
  supabase: AppSupabaseClient,
  userId: string,
  emailAccountId: string,
): Promise<GmailMailboxAccess> {
  const { data: account } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", emailAccountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!account) {
    return {
      ok: false,
      code: "not_found",
      error: "Gmail account not found.",
    };
  }

  if (account.provider !== "gmail") {
    return {
      ok: false,
      code: "unsupported",
      error: "Gmail Cleaner only works with connected Gmail accounts.",
    };
  }

  if (
    account.status === "disconnected" ||
    account.status === "needs_reauth"
  ) {
    return {
      ok: false,
      code: "auth_required",
      error: "Your Gmail connection needs to be reauthorized.",
    };
  }

  if (!hasGmailModifyScope(account.scopes)) {
    return {
      ok: false,
      code: "missing_modify_scope",
      error:
        "Additional Gmail permission is required to scan your mailbox and move messages to Trash. Grant mailbox access, then try again. Existing campaign sending is unchanged.",
    };
  }

  const { data: credentials } = await supabase
    .from("email_account_credentials")
    .select("*")
    .eq("email_account_id", account.id)
    .maybeSingle();

  if (!credentials?.encrypted_refresh_token) {
    await supabase
      .from("email_accounts")
      .update({
        status: "needs_reauth",
        last_error: "Missing OAuth credentials",
      })
      .eq("id", account.id);

    return {
      ok: false,
      code: "auth_required",
      error: "Your Gmail connection needs to be reauthorized.",
    };
  }

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = decryptSecret(credentials.encrypted_access_token);
    refreshToken = decryptSecret(credentials.encrypted_refresh_token);
  } catch {
    await supabase
      .from("email_accounts")
      .update({
        status: "needs_reauth",
        last_error: "Stored Gmail credentials could not be read",
      })
      .eq("id", account.id);

    return {
      ok: false,
      code: "auth_required",
      error: "Your Gmail connection needs to be reauthorized.",
    };
  }

  const expiresAt = account.token_expiry
    ? new Date(account.token_expiry).getTime()
    : 0;

  if (!expiresAt || expiresAt - ACCESS_TOKEN_SKEW_MS <= Date.now()) {
    try {
      const refreshed = await refreshGoogleAccessTokenWithRetry(refreshToken);
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

      const nextScopes = mergeGoogleScopes(
        account.scopes,
        refreshed.scope ? refreshed.scope.split(/\s+/).filter(Boolean) : [],
      );

      await supabase
        .from("email_accounts")
        .update({
          status: "connected",
          token_expiry: new Date(
            Date.now() + refreshed.expires_in * 1000,
          ).toISOString(),
          scopes: nextScopes,
          last_error: null,
        })
        .eq("id", account.id);

      if (!hasGmailModifyScope(nextScopes)) {
        return {
          ok: false,
          code: "missing_modify_scope",
          error:
            "Additional Gmail permission is required to scan your mailbox and move messages to Trash.",
        };
      }
    } catch (error) {
      const isTransient =
        error instanceof GoogleTokenRefreshError &&
        error.kind === "transient";

      if (!isTransient) {
        await supabase
          .from("email_accounts")
          .update({
            status: "needs_reauth",
            last_error: "Token refresh failed",
          })
          .eq("id", account.id);
      }

      return {
        ok: false,
        code: isTransient ? "transient" : "auth_required",
        error: isTransient
          ? "Gmail is temporarily unavailable. Try again shortly."
          : "Your Gmail connection needs to be reauthorized.",
      };
    }
  }

  return {
    ok: true,
    accountId: account.id,
    email: account.email,
    displayName: account.display_name,
    accessToken,
    scopes: account.scopes ?? [],
  };
}
