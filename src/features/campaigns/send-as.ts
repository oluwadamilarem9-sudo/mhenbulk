import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import {
  filterUsableGmailSendAs,
  findUsableGmailSendAs,
  GmailSendAsError,
  listGmailSendAsIdentities,
  primarySendAsFallback,
  type GmailSendAsIdentity,
  type UsableGmailSendAs,
} from "@/lib/google/gmail-send-as";
import { hasGmailModifyScope } from "@/lib/google/scopes";
import {
  GoogleTokenRefreshError,
  refreshGoogleAccessTokenWithRetry,
} from "@/lib/google/oauth";
import type { Database } from "@/lib/supabase/database.types";

type AppSupabaseClient = SupabaseClient<Database>;

const ACCESS_TOKEN_SKEW_MS = 60_000;

export type CampaignSenderIdentity = {
  emailAccountId: string;
  provider: string;
  fromEmail: string;
  fromName: string | null;
  replyToEmail: string | null;
  isPrimary: boolean;
  aliasesAvailable: boolean;
  aliasListError?: string;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

async function loadOwnedGmailAccount(
  supabase: AppSupabaseClient,
  userId: string,
  emailAccountId: string,
) {
  const { data } = await supabase
    .from("email_accounts")
    .select(
      "id, user_id, email, display_name, status, provider, scopes, token_expiry, preferred_send_as_email",
    )
    .eq("id", emailAccountId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

async function getGmailAccessToken(
  supabase: AppSupabaseClient,
  account: {
    id: string;
    token_expiry: string | null;
  },
): Promise<
  | { ok: true; accessToken: string }
  | { ok: false; error: string; code: "auth_required" | "transient" }
> {
  const { data: credentials } = await supabase
    .from("email_account_credentials")
    .select("encrypted_access_token, encrypted_refresh_token")
    .eq("email_account_id", account.id)
    .maybeSingle();

  if (!credentials?.encrypted_refresh_token) {
    return {
      ok: false,
      error: "Your Gmail connection needs to be reauthorized.",
      code: "auth_required",
    };
  }

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = decryptSecret(credentials.encrypted_access_token);
    refreshToken = decryptSecret(credentials.encrypted_refresh_token);
  } catch {
    return {
      ok: false,
      error: "Your Gmail connection needs to be reauthorized.",
      code: "auth_required",
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
      const isTransient =
        error instanceof GoogleTokenRefreshError && error.kind === "transient";
      return {
        ok: false,
        error: isTransient
          ? "Gmail is temporarily unavailable. Try again shortly."
          : "Your Gmail connection needs to be reauthorized.",
        code: isTransient ? "transient" : "auth_required",
      };
    }
  }

  return { ok: true, accessToken };
}

async function persistSendAsCache(
  supabase: AppSupabaseClient,
  userId: string,
  emailAccountId: string,
  identities: GmailSendAsIdentity[],
) {
  const syncedAt = new Date().toISOString();
  const rows = identities.map((identity) => ({
    user_id: userId,
    email_account_id: emailAccountId,
    send_as_email: identity.sendAsEmail,
    display_name: identity.displayName,
    reply_to_email: identity.replyToAddress,
    is_primary: identity.isPrimary,
    is_default: identity.isDefault,
    treat_as_alias: identity.treatAsAlias,
    verification_status: identity.verificationStatus,
    is_usable:
      identity.isPrimary || identity.verificationStatus === "accepted",
    synced_at: syncedAt,
  }));

  await supabase
    .from("email_account_send_as")
    .delete()
    .eq("email_account_id", emailAccountId)
    .eq("user_id", userId);

  if (rows.length > 0) {
    await supabase.from("email_account_send_as").insert(rows);
  }
}

export async function listUsableSendAsForAccount(
  supabase: AppSupabaseClient,
  userId: string,
  emailAccountId: string,
): Promise<
  | {
      ok: true;
      provider: string;
      aliases: UsableGmailSendAs[];
      aliasesAvailable: boolean;
      warning?: string;
      preferredEmail: string | null;
    }
  | { ok: false; error: string; code?: string }
> {
  const account = await loadOwnedGmailAccount(supabase, userId, emailAccountId);
  if (!account) {
    return { ok: false, error: "Sending account not found.", code: "not_found" };
  }

  if (account.provider !== "gmail") {
    const primary = primarySendAsFallback(account.email, account.display_name);
    return {
      ok: true,
      provider: account.provider,
      aliases: [primary],
      aliasesAvailable: false,
      preferredEmail: account.preferred_send_as_email,
      warning:
        "Send-as aliases are only available for connected Gmail accounts.",
    };
  }

  if (
    account.status === "disconnected" ||
    account.status === "needs_reauth"
  ) {
    return {
      ok: false,
      error: "Your Gmail connection needs to be reauthorized.",
      code: "auth_required",
    };
  }

  const primary = primarySendAsFallback(account.email, account.display_name);

  if (!hasGmailModifyScope(account.scopes)) {
    return {
      ok: true,
      provider: "gmail",
      aliases: [primary],
      aliasesAvailable: false,
      preferredEmail: account.preferred_send_as_email,
      warning:
        "Reconnect this Gmail account with mailbox permission to load verified Send mail as aliases.",
    };
  }

  const token = await getGmailAccessToken(supabase, account);
  if (!token.ok) {
    return { ok: false, error: token.error, code: token.code };
  }

  try {
    const identities = await listGmailSendAsIdentities(token.accessToken);
    await persistSendAsCache(supabase, userId, account.id, identities);
    const aliases = filterUsableGmailSendAs(identities);
    return {
      ok: true,
      provider: "gmail",
      aliases: aliases.length > 0 ? aliases : [primary],
      aliasesAvailable: aliases.length > 1,
      preferredEmail: account.preferred_send_as_email,
    };
  } catch (error) {
    if (error instanceof GmailSendAsError && error.code === "forbidden") {
      return {
        ok: true,
        provider: "gmail",
        aliases: [primary],
        aliasesAvailable: false,
        preferredEmail: account.preferred_send_as_email,
        warning: error.message,
      };
    }
    if (error instanceof GmailSendAsError && error.code === "auth_required") {
      return { ok: false, error: error.message, code: "auth_required" };
    }
    return {
      ok: true,
      provider: "gmail",
      aliases: [primary],
      aliasesAvailable: false,
      preferredEmail: account.preferred_send_as_email,
      warning:
        error instanceof Error
          ? error.message
          : "Could not refresh Gmail send-as aliases.",
    };
  }
}

/**
 * Server-side validation: never trust a From address from the client without
 * confirming it belongs to this user's connected account as a usable identity.
 */
export async function resolveVerifiedCampaignSender(
  supabase: AppSupabaseClient,
  userId: string,
  emailAccountId: string,
  requestedFromEmail?: string | null,
): Promise<
  | { ok: true; value: CampaignSenderIdentity }
  | { ok: false; error: string; code?: string }
> {
  const listed = await listUsableSendAsForAccount(
    supabase,
    userId,
    emailAccountId,
  );
  if (!listed.ok) return listed;

  const requested = requestedFromEmail?.trim()
    ? normalizeEmail(requestedFromEmail)
    : normalizeEmail(
        listed.preferredEmail || listed.aliases[0]?.email || "",
      );

  if (!requested) {
    return { ok: false, error: "Select a sending address." };
  }

  const match = listed.aliases.find((alias) => alias.email === requested);
  if (!match) {
    // Live re-check against Google when cache/list might be stale for Gmail.
    if (listed.provider === "gmail" && listed.aliasesAvailable) {
      return {
        ok: false,
        error:
          "That sending address is not a verified Send mail as identity on this Gmail account.",
        code: "invalid_from",
      };
    }
    if (listed.provider === "gmail") {
      // Send-only scope: only the primary connected address is allowed.
      const primary = listed.aliases[0];
      if (!primary || primary.email !== requested) {
        return {
          ok: false,
          error:
            "Only the primary Gmail address can be used until send-as aliases are available for this account.",
          code: "invalid_from",
        };
      }
      return {
        ok: true,
        value: {
          emailAccountId,
          provider: listed.provider,
          fromEmail: primary.email,
          fromName: primary.displayName,
          replyToEmail: primary.replyToAddress,
          isPrimary: true,
          aliasesAvailable: false,
          aliasListError: listed.warning,
        },
      };
    }
    return {
      ok: false,
      error: "That sending address does not belong to the selected account.",
      code: "invalid_from",
    };
  }

  // For Gmail with modify scope, re-validate against a fresh list when possible.
  if (listed.provider === "gmail" && listed.aliasesAvailable) {
    const account = await loadOwnedGmailAccount(supabase, userId, emailAccountId);
    if (account) {
      const token = await getGmailAccessToken(supabase, account);
      if (token.ok) {
        try {
          const identities = await listGmailSendAsIdentities(token.accessToken);
          await persistSendAsCache(supabase, userId, account.id, identities);
          const live = findUsableGmailSendAs(identities, requested);
          if (!live) {
            return {
              ok: false,
              error:
                "That send-as alias is no longer verified in Gmail. Choose another address or re-verify it in Gmail settings.",
              code: "invalid_from",
            };
          }
          await supabase
            .from("email_accounts")
            .update({ preferred_send_as_email: live.email })
            .eq("id", emailAccountId)
            .eq("user_id", userId);
          return {
            ok: true,
            value: {
              emailAccountId,
              provider: "gmail",
              fromEmail: live.email,
              fromName: live.displayName,
              replyToEmail: live.replyToAddress,
              isPrimary: live.isPrimary,
              aliasesAvailable: true,
            },
          };
        } catch (error) {
          if (error instanceof GmailSendAsError && error.code === "auth_required") {
            return { ok: false, error: error.message, code: "auth_required" };
          }
          // Fall through to cached match only if live refresh fails transiently.
        }
      }
    }
  }

  await supabase
    .from("email_accounts")
    .update({ preferred_send_as_email: match.email })
    .eq("id", emailAccountId)
    .eq("user_id", userId);

  return {
    ok: true,
    value: {
      emailAccountId,
      provider: listed.provider,
      fromEmail: match.email,
      fromName: match.displayName,
      replyToEmail: match.replyToAddress,
      isPrimary: match.isPrimary,
      aliasesAvailable: listed.aliasesAvailable,
      aliasListError: listed.warning,
    },
  };
}

/**
 * Queue-time From resolution. Never silently falls back to primary when a
 * non-primary campaign.from_email was stored.
 */
export async function resolveSenderForQueuedCampaign(
  supabase: AppSupabaseClient,
  userId: string,
  emailAccountId: string,
  campaignFromEmail: string | null,
  campaignFromName: string | null,
  campaignReplyTo: string | null,
): Promise<
  | {
      ok: true;
      fromEmail: string;
      fromName: string | null;
      replyToEmail: string | null;
    }
  | { ok: false; error: string; code: string; retryable: boolean }
> {
  const account = await loadOwnedGmailAccount(supabase, userId, emailAccountId);
  if (!account) {
    return {
      ok: false,
      error: "Sending account not found.",
      code: "not_found",
      retryable: false,
    };
  }

  const desired = normalizeEmail(campaignFromEmail || account.email);

  if (account.provider !== "gmail") {
    if (desired !== normalizeEmail(account.email)) {
      return {
        ok: false,
        error: "Campaign From address does not match the connected account.",
        code: "invalid_from",
        retryable: false,
      };
    }
    return {
      ok: true,
      fromEmail: normalizeEmail(account.email),
      fromName: campaignFromName ?? account.display_name,
      replyToEmail: campaignReplyTo,
    };
  }

  if (!hasGmailModifyScope(account.scopes)) {
    if (desired !== normalizeEmail(account.email)) {
      return {
        ok: false,
        error:
          "This campaign uses a send-as alias, but the Gmail account can no longer list verified aliases. Reconnect with mailbox permission or edit the campaign to use the primary address.",
        code: "invalid_from",
        retryable: false,
      };
    }
    return {
      ok: true,
      fromEmail: normalizeEmail(account.email),
      fromName: campaignFromName ?? account.display_name,
      replyToEmail: campaignReplyTo,
    };
  }

  const token = await getGmailAccessToken(supabase, account);
  if (!token.ok) {
    return {
      ok: false,
      error: token.error,
      code: token.code,
      retryable: token.code === "transient",
    };
  }

  try {
    const identities = await listGmailSendAsIdentities(token.accessToken);
    await persistSendAsCache(supabase, userId, account.id, identities);
    const live = findUsableGmailSendAs(identities, desired);
    if (!live) {
      return {
        ok: false,
        error:
          `The selected sender ${desired} is no longer a verified Gmail send-as identity. Sending was stopped so mail is not delivered from the primary address instead.`,
        code: "invalid_from",
        retryable: false,
      };
    }
    return {
      ok: true,
      fromEmail: live.email,
      fromName: campaignFromName ?? live.displayName ?? account.display_name,
      replyToEmail: campaignReplyTo ?? live.replyToAddress,
    };
  } catch (error) {
    if (error instanceof GmailSendAsError) {
      return {
        ok: false,
        error: error.message,
        code: error.code,
        retryable: error.code === "transient" || error.code === "rate_limited",
      };
    }
    return {
      ok: false,
      error: "Unable to verify the campaign send-as identity with Gmail.",
      code: "provider_error",
      retryable: true,
    };
  }
}
