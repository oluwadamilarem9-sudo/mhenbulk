import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import {
  buildSendAsInventory,
  filterUsableGmailSendAs,
  findUsableGmailSendAs,
  GmailSendAsError,
  listGmailSendAsIdentitiesWithStatus,
  primarySendAsFallback,
  type GmailSendAsIdentity,
  type SendAsInventoryItem,
  type UsableGmailSendAs,
} from "@/lib/google/gmail-send-as";
import {
  hasGmailSendAsListScope,
  normalizeGoogleScopes,
} from "@/lib/google/scopes";
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

export type ListSendAsForAccountResult =
  | {
      ok: true;
      provider: string;
      accountId: string;
      accountEmail: string;
      aliases: UsableGmailSendAs[];
      inventory: SendAsInventoryItem[];
      aliasesAvailable: boolean;
      preferredEmail: string | null;
      warning?: string;
      diagnostics: {
        scopes: string[];
        hasListScopeInDb: boolean;
        httpStatus: number | null;
        returnedCount: number;
        usableCount: number;
        excluded: Array<{ email: string; reason: string; status: string | null }>;
      };
    }
  | { ok: false; error: string; code?: string };

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function logSendAsDiagnostics(payload: Record<string, unknown>) {
  // Never log tokens or secrets.
  console.info("[gmail-send-as]", payload);
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
  options: { forceRefresh?: boolean } = {},
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
      error:
        "Gmail credentials are unavailable for this account. Reconnect the account (service-role credential access is required).",
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
  const needsRefresh =
    options.forceRefresh ||
    !expiresAt ||
    expiresAt - ACCESS_TOKEN_SKEW_MS <= Date.now();

  if (needsRefresh) {
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
      // When Google returns scope on refresh, persist it so DB matches the token.
      const refreshedScopes = refreshed.scope
        ? normalizeGoogleScopes(refreshed.scope)
        : null;
      await supabase
        .from("email_accounts")
        .update({
          status: "connected",
          token_expiry: new Date(
            Date.now() + refreshed.expires_in * 1000,
          ).toISOString(),
          last_error: null,
          ...(refreshedScopes ? { scopes: refreshedScopes } : {}),
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
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

    const { error: deleteError } = await supabase
      .from("email_account_send_as")
      .delete()
      .eq("email_account_id", emailAccountId)
      .eq("user_id", userId);
    if (deleteError) {
      return { ok: false, error: deleteError.message };
    }

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from("email_account_send_as")
        .insert(rows);
      if (insertError) {
        return { ok: false, error: insertError.message };
      }
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to cache send-as aliases.",
    };
  }
}

/** @deprecated Prefer listSendAsForAccount — kept for callers expecting usable-only. */
export async function listUsableSendAsForAccount(
  supabase: AppSupabaseClient,
  userId: string,
  emailAccountId: string,
) {
  return listSendAsForAccount(supabase, userId, emailAccountId);
}

/**
 * Account-scoped send-as listing. Always uses this account's credentials only.
 * Cache write failures never hide aliases returned by Google.
 */
export async function listSendAsForAccount(
  supabase: AppSupabaseClient,
  userId: string,
  emailAccountId: string,
): Promise<ListSendAsForAccountResult> {
  const account = await loadOwnedGmailAccount(supabase, userId, emailAccountId);
  if (!account) {
    return { ok: false, error: "Sending account not found.", code: "not_found" };
  }

  const scopes = Array.isArray(account.scopes) ? account.scopes : [];
  const hasListScopeInDb = hasGmailSendAsListScope(scopes);
  const primary = primarySendAsFallback(account.email, account.display_name);

  if (account.provider !== "gmail") {
    return {
      ok: true,
      provider: account.provider,
      accountId: account.id,
      accountEmail: account.email,
      aliases: [primary],
      inventory: [
        {
          email: primary.email,
          displayName: primary.displayName,
          replyToAddress: null,
          isPrimary: true,
          isDefault: true,
          treatAsAlias: false,
          verificationStatus: null,
          usable: true,
          statusLabel: "Verified and available (primary)",
          exclusionReason: "primary",
        },
      ],
      aliasesAvailable: false,
      preferredEmail: account.preferred_send_as_email,
      warning:
        "Send-as aliases are only available for connected Gmail accounts.",
      diagnostics: {
        scopes,
        hasListScopeInDb: false,
        httpStatus: null,
        returnedCount: 1,
        usableCount: 1,
        excluded: [],
      },
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

  // Always attempt the live API with this account's token. Do not hard-block on
  // DB scope flags — they can lag behind a successful reconnect.
  const token = await getGmailAccessToken(supabase, account, {
    forceRefresh: true,
  });
  if (!token.ok) {
    logSendAsDiagnostics({
      accountId: account.id,
      accountEmail: account.email,
      scopes,
      hasListScopeInDb,
      stage: "token",
      error: token.error,
      code: token.code,
    });
    return { ok: false, error: token.error, code: token.code };
  }

  try {
    const listed = await listGmailSendAsIdentitiesWithStatus(token.accessToken);
    const inventory = buildSendAsInventory(listed.identities);
    const aliases = filterUsableGmailSendAs(listed.identities);
    const excluded = inventory
      .filter((item) => !item.usable)
      .map((item) => ({
        email: item.email,
        reason: item.statusLabel,
        status: item.verificationStatus,
      }));

    const cacheResult = await persistSendAsCache(
      supabase,
      userId,
      account.id,
      listed.identities,
    );

    logSendAsDiagnostics({
      accountId: account.id,
      accountEmail: account.email,
      scopes,
      hasListScopeInDb,
      httpStatus: listed.httpStatus,
      returnedCount: listed.identities.length,
      usableCount: aliases.length,
      returnedEmails: listed.identities.map((item) => ({
        email: item.sendAsEmail,
        isPrimary: item.isPrimary,
        verificationStatus: item.verificationStatus,
      })),
      excluded,
      cacheOk: cacheResult.ok,
      cacheError: cacheResult.ok ? null : cacheResult.error,
    });

    const warnings: string[] = [];
    if (!hasListScopeInDb) {
      warnings.push(
        "Stored OAuth scopes do not include mailbox/settings access, but Gmail accepted the send-as list request.",
      );
    }
    if (!cacheResult.ok) {
      warnings.push(
        `Alias cache could not be saved (${cacheResult.error}). Live Gmail results are still shown — apply migration 0024 if the send-as table is missing.`,
      );
    }
    if (aliases.length <= 1 && listed.identities.length > 1) {
      warnings.push(
        "Gmail returned additional send-as identities, but they are not verified for sending yet. See status details below.",
      );
    }
    if (aliases.length <= 1 && listed.identities.length <= 1) {
      warnings.push(
        "Gmail only returned the primary address for this account. Confirm info@… is added under Gmail Settings → Accounts → Send mail as for this exact mailbox.",
      );
    }

    return {
      ok: true,
      provider: "gmail",
      accountId: account.id,
      accountEmail: account.email,
      aliases: aliases.length > 0 ? aliases : [primary],
      inventory:
        inventory.length > 0
          ? inventory
          : [
              {
                email: primary.email,
                displayName: primary.displayName,
                replyToAddress: null,
                isPrimary: true,
                isDefault: true,
                treatAsAlias: false,
                verificationStatus: null,
                usable: true,
                statusLabel: "Verified and available (primary)",
                exclusionReason: "primary",
              },
            ],
      aliasesAvailable: aliases.length > 1,
      preferredEmail: account.preferred_send_as_email,
      warning: warnings.length > 0 ? warnings.join(" ") : undefined,
      diagnostics: {
        scopes,
        hasListScopeInDb,
        httpStatus: listed.httpStatus,
        returnedCount: listed.identities.length,
        usableCount: aliases.length,
        excluded,
      },
    };
  } catch (error) {
    if (error instanceof GmailSendAsError && error.code === "forbidden") {
      logSendAsDiagnostics({
        accountId: account.id,
        accountEmail: account.email,
        scopes,
        hasListScopeInDb,
        httpStatus: error.status,
        stage: "list",
        error: error.message,
        code: error.code,
      });
      return {
        ok: true,
        provider: "gmail",
        accountId: account.id,
        accountEmail: account.email,
        aliases: [primary],
        inventory: [
          {
            email: primary.email,
            displayName: primary.displayName,
            replyToAddress: null,
            isPrimary: true,
            isDefault: true,
            treatAsAlias: false,
            verificationStatus: null,
            usable: true,
            statusLabel: "Verified and available (primary)",
            exclusionReason: "primary",
          },
        ],
        aliasesAvailable: false,
        preferredEmail: account.preferred_send_as_email,
        warning: error.message,
        diagnostics: {
          scopes,
          hasListScopeInDb,
          httpStatus: error.status,
          returnedCount: 0,
          usableCount: 1,
          excluded: [
            {
              email: "(api)",
              reason: error.message,
              status: "api_access_failed",
            },
          ],
        },
      };
    }
    if (error instanceof GmailSendAsError && error.code === "auth_required") {
      return { ok: false, error: error.message, code: "auth_required" };
    }
    const message =
      error instanceof Error
        ? error.message
        : "Could not refresh Gmail send-as aliases.";
    logSendAsDiagnostics({
      accountId: account.id,
      accountEmail: account.email,
      scopes,
      hasListScopeInDb,
      stage: "list",
      error: message,
    });
    return {
      ok: true,
      provider: "gmail",
      accountId: account.id,
      accountEmail: account.email,
      aliases: [primary],
      inventory: [
        {
          email: primary.email,
          displayName: primary.displayName,
          replyToAddress: null,
          isPrimary: true,
          isDefault: true,
          treatAsAlias: false,
          verificationStatus: null,
          usable: true,
          statusLabel: "Verified and available (primary)",
          exclusionReason: "primary",
        },
      ],
      aliasesAvailable: false,
      preferredEmail: account.preferred_send_as_email,
      warning: message,
      diagnostics: {
        scopes,
        hasListScopeInDb,
        httpStatus: null,
        returnedCount: 0,
        usableCount: 1,
        excluded: [{ email: "(api)", reason: message, status: "api_access_failed" }],
      },
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
  const listed = await listSendAsForAccount(supabase, userId, emailAccountId);
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
    const inventoryHit = listed.inventory.find((item) => item.email === requested);
    if (inventoryHit && !inventoryHit.usable) {
      return {
        ok: false,
        error: `${requested} cannot be used: ${inventoryHit.statusLabel}.`,
        code: "invalid_from",
      };
    }
    if (listed.provider === "gmail" && listed.aliasesAvailable) {
      return {
        ok: false,
        error:
          "That sending address is not a verified Send mail as identity on this Gmail account.",
        code: "invalid_from",
      };
    }
    if (listed.provider === "gmail") {
      const primary = listed.aliases[0];
      if (!primary || primary.email !== requested) {
        return {
          ok: false,
          error:
            "Only the primary Gmail address can be used until verified send-as aliases are available for this account.",
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

  const token = await getGmailAccessToken(supabase, account, {
    forceRefresh: true,
  });
  if (!token.ok) {
    return {
      ok: false,
      error: token.error,
      code: token.code,
      retryable: token.code === "transient",
    };
  }

  try {
    const listed = await listGmailSendAsIdentitiesWithStatus(token.accessToken);
    await persistSendAsCache(supabase, userId, account.id, listed.identities);
    const live = findUsableGmailSendAs(listed.identities, desired);
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
      // If the campaign only needs primary and list failed for scope reasons,
      // still allow primary-only delivery.
      if (
        error.code === "forbidden" &&
        desired === normalizeEmail(account.email)
      ) {
        return {
          ok: true,
          fromEmail: normalizeEmail(account.email),
          fromName: campaignFromName ?? account.display_name,
          replyToEmail: campaignReplyTo,
        };
      }
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
