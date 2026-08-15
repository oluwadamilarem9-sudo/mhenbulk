import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { encryptSecret } from "@/lib/crypto/secrets";
import {
  exchangeAuthorizationCode,
  fetchGoogleUserInfo,
} from "@/lib/google/oauth";
import { GMAIL_SEND_SCOPES } from "@/lib/google/scopes";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "mhenbulk_google_oauth_state";
const VERIFIER_COOKIE = "mhenbulk_google_oauth_verifier";

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
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(VERIFIER_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const secure = (process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https");

  if (oauthError) {
    const response = NextResponse.redirect(
      appUrl(
        oauthError === "access_denied"
          ? "/settings/email-accounts?error=oauth_cancelled"
          : `/settings/email-accounts?error=${encodeURIComponent(oauthError)}`,
      ),
    );
    clearOAuthCookies(response, secure);
    return response;
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  const codeVerifier = cookieStore.get(VERIFIER_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
    const response = NextResponse.redirect(
      appUrl("/settings/email-accounts?error=invalid_oauth_state"),
    );
    clearOAuthCookies(response, secure);
    return response;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const response = NextResponse.redirect(appUrl("/login?next=/settings/email-accounts"));
    clearOAuthCookies(response, secure);
    return response;
  }

  try {
    const tokens = await exchangeAuthorizationCode({ code, codeVerifier });

    if (!tokens.refresh_token) {
      const response = NextResponse.redirect(
        appUrl("/settings/email-accounts?error=missing_refresh_token"),
      );
      clearOAuthCookies(response, secure);
      return response;
    }

    const profile = await fetchGoogleUserInfo(tokens.access_token);

    if (!profile.email) {
      const response = NextResponse.redirect(
        appUrl("/settings/email-accounts?error=missing_email"),
      );
      clearOAuthCookies(response, secure);
      return response;
    }

    const service = createServiceRoleClient();
    const tokenExpiry = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();
    const scopes = (tokens.scope || GMAIL_SEND_SCOPES.join(" "))
      .split(/\s+/)
      .filter(Boolean);

    const { data: existing } = await service
      .from("email_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .eq("provider_account_id", profile.sub)
      .maybeSingle();

    let accountId = existing?.id;

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

    const encryptedAccess = encryptSecret(tokens.access_token);
    const encryptedRefresh = encryptSecret(tokens.refresh_token);

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

    const response = NextResponse.redirect(
      appUrl("/settings/email-accounts?connected=1"),
    );
    clearOAuthCookies(response, secure);
    return response;
  } catch (error) {
    console.error("[google-oauth] callback failed", error);
    const response = NextResponse.redirect(
      appUrl("/settings/email-accounts?error=oauth_failed"),
    );
    clearOAuthCookies(response, secure);
    return response;
  }
}
