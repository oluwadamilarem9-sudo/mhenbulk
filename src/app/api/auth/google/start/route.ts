import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  buildGoogleAuthUrl,
  createOAuthState,
  createPkcePair,
} from "@/lib/google/oauth";
import type { GmailOAuthIntent } from "@/lib/google/scopes";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "mhenbulk_google_oauth_state";
const VERIFIER_COOKIE = "mhenbulk_google_oauth_verifier";
const INTENT_COOKIE = "mhenbulk_google_oauth_intent";
const RETURN_COOKIE = "mhenbulk_google_oauth_return";

function parseIntent(value: string | null): GmailOAuthIntent {
  return value === "cleaner" ? "cleaner" : "send";
}

function parseReturnPath(value: string | null): string {
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
  const intent = parseIntent(url.searchParams.get("intent"));
  const returnTo = parseReturnPath(url.searchParams.get("returnTo"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      new URL(
        `/login?next=${encodeURIComponent(returnTo)}`,
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      ),
    );
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(
      new URL(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=google_not_configured`,
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      ),
    );
  }

  if (!process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY) {
    return NextResponse.redirect(
      new URL(
        `${returnTo}${returnTo.includes("?") ? "&" : "?"}error=encryption_not_configured`,
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      ),
    );
  }

  const state = createOAuthState();
  const { verifier, challenge } = createPkcePair();
  const authUrl = buildGoogleAuthUrl({
    state,
    codeChallenge: challenge,
    prompt: "consent",
    intent,
  });

  const cookieStore = await cookies();
  const secure = (process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https");
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 600,
  };

  cookieStore.set(STATE_COOKIE, state, cookieOpts);
  cookieStore.set(VERIFIER_COOKIE, verifier, cookieOpts);
  cookieStore.set(INTENT_COOKIE, intent, cookieOpts);
  cookieStore.set(RETURN_COOKIE, returnTo, cookieOpts);

  return NextResponse.redirect(authUrl);
}
