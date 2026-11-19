import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { encryptSecret } from "@/lib/crypto/secrets";
import { resumeCampaignsAfterAccountReconnect } from "@/features/campaigns/queue-worker";
import {
  exchangeAuthorizationCode,
  fetchGoogleUserInfo,
} from "@/lib/google/oauth";
import {
  GMAIL_SEND_SCOPES,
  hasGmailModifyScope,
  mergeGoogleScopes,
  normalizeGoogleScopes,
} from "@/lib/google/scopes";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "mhenbulk_google_oauth_state";
const VERIFIER_COOKIE = "mhenbulk_google_oauth_verifier";
const INTENT_COOKIE = "mhenbulk_google_oauth_intent";
const RETURN_COOKIE = "mhenbulk_google_oauth_return";

function appUrl(path: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return new URL(path, base);
}

function clearOAuthCookies(
  response: NextResponse,
  secure: boolean,
) {
  for (const name of [
    STATE_COOKIE,
    VERIFIER_COOKIE,
    INTENT_COOKIE,
    RETURN_COOKIE,
  ]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 0,
    });
  }
}

function safeReturnPath(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/settings/email-accounts";
  }
  if (value.startsWith("/api/")) {
    return "/settings/email-accounts";
  }
  return value.slice(0, 200);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const secure = (process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https");

  const cookieStore = await cookies();
  const returnTo = safeReturnPath(cookieStore.get(RETURN_COOKIE)?.value);
  const oauthIntent = cookieStore.get(INTENT_COOKIE)?.value;

  if (oauthError) {
    const response = NextResponse.redirect(
      appUrl(
        oauthError === "access_denied"
          ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=oauth_cancelled`
          : `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(oauthError)}`,
      ),
    );
    clearOAuthCookies(response, secure);
    return response;
  }

  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  const codeVerifier = cookieStore.get(VERIFIER_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
    const response = NextResponse.redirect(
      appUrl(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=invalid_oauth_state`),
    );
    clearOAuthCookies(response, secure);
    return response;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const response = NextResponse.redirect(
      appUrl(`/login?next=${encodeURIComponent(returnTo)}`),
    );
    clearOAuthCookies(response, secure);
    return response;
  }

  try {
    const tokens = await exchangeAuthorizationCode({ code, codeVerifier });

    const profile = await fetchGoogleUserInfo(tokens.access_token);

    if (!profile.email) {
      const response = NextResponse.redirect(
        appUrl(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_email`),
      );
      clearOAuthCookies(response, secure);
      return response;
    }

    const service = createServiceRoleClient();
    const tokenExpiry = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();
    const grantedScopes = normalizeGoogleScopes(
      tokens.scope || GMAIL_SEND_SCOPES.join(" "),
    );

    const { data: existing } = await service
      .from("email_accounts")
      .select("id, scopes")
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .eq("provider_account_id", profile.sub)
      .maybeSingle();

    let accountId = existing?.id;
    // Merge so a send-only reconnect cannot wipe a previously granted modify scope
    // if Google returns a partial scope string.
    const scopes = mergeGoogleScopes(existing?.scopes, grantedScopes);

    if (accountId) {
      const { error: updateError } = await service
        .from("email_accounts")
        .update({
          email: profile.email.toLowerCase(),
          display_name: profile.name ?? null,
          status: "connected",
          scopes,
          token_expiry: tokenExpiry,
          rate_limited_until: null,
          last_error: null,
        })
        .eq("id", accountId)
        .eq("user_id", user.id);

      if (updateError) {
        throw updateError;
      }
    } else {
      const { data: inserted, error: insertError } = await service
        .from("email_accounts")
        .insert({
          user_id: user.id,
          provider: "gmail",
          provider_account_id: profile.sub,
          email: profile.email.toLowerCase(),
          display_name: profile.name ?? null,
          status: "connected",
          scopes,
          token_expiry: tokenExpiry,
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        throw insertError ?? new Error("Failed to create email account");
      }

      accountId = inserted.id;
    }

    let encryptedRefresh: string;
    if (tokens.refresh_token) {
      encryptedRefresh = encryptSecret(tokens.refresh_token);
    } else {
      const { data: existingCredentials } = await service
        .from("email_account_credentials")
        .select("encrypted_refresh_token")
        .eq("email_account_id", accountId)
        .maybeSingle();

      if (!existingCredentials?.encrypted_refresh_token) {
        const response = NextResponse.redirect(
          appUrl(
            `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=missing_refresh_token`,
          ),
        );
        clearOAuthCookies(response, secure);
        return response;
      }
      encryptedRefresh = existingCredentials.encrypted_refresh_token;
    }

    const encryptedAccess = encryptSecret(tokens.access_token);

    const { error: credError } = await service
      .from("email_account_credentials")
      .upsert(
        {
          email_account_id: accountId,
          encrypted_access_token: encryptedAccess,
          encrypted_refresh_token: encryptedRefresh,
          key_version: 1,
        },
        { onConflict: "email_account_id" },
      );

    if (credError) {
      throw credError;
    }

    const resumed = await resumeCampaignsAfterAccountReconnect(
      service,
      user.id,
      accountId,
    );
    if (resumed > 0) {
      console.info("[google-oauth] resumed campaigns after reconnect", {
        accountId,
        resumed,
      });
    }

    const query = new URLSearchParams({ connected: "1" });
    if (resumed > 0) query.set("resumed", "1");
    if (oauthIntent === "cleaner") {
      query.set(
        "mailbox",
        hasGmailModifyScope(scopes) ? "granted" : "missing_modify",
      );
    }
    const separator = returnTo.includes("?") ? "&" : "?";
    const response = NextResponse.redirect(
      appUrl(`${returnTo}${separator}${query.toString()}`),
    );
    clearOAuthCookies(response, secure);
    return response;
  } catch (error) {
    console.error("[google-oauth] callback failed", error);
    const isConfigError =
      error instanceof Error &&
      /environment configuration|is not configured/i.test(error.message);
    const response = NextResponse.redirect(
      appUrl(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${
          isConfigError ? "server_misconfigured" : "oauth_failed"
        }`,
      ),
    );
    clearOAuthCookies(response, secure);
    return response;
  }
}
