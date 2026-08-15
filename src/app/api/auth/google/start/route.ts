import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  buildGoogleAuthUrl,
  createOAuthState,
  createPkcePair,
} from "@/lib/google/oauth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "mhenbulk_google_oauth_state";
const VERIFIER_COOKIE = "mhenbulk_google_oauth_verifier";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      new URL("/login?next=/settings/email-accounts", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
    );
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(
      new URL(
        "/settings/email-accounts?error=google_not_configured",
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      ),
    );
  }

  if (!process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY) {
    return NextResponse.redirect(
      new URL(
        "/settings/email-accounts?error=encryption_not_configured",
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
  });

  const cookieStore = await cookies();
  const secure = (process.env.NEXT_PUBLIC_APP_URL || "").startsWith("https");

  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });
  cookieStore.set(VERIFIER_COOKIE, verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(authUrl);
}
