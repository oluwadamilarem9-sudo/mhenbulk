import { createHash, randomBytes } from "node:crypto";

import { gmailScopesString } from "@/lib/google/scopes";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
};

function requireGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured.",
    );
  }

  return { clientId, clientSecret, redirectUri };
}

export function createOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildGoogleAuthUrl(options: {
  state: string;
  codeChallenge: string;
  prompt?: "consent" | "select_account" | "none";
}): string {
  const { clientId, redirectUri } = requireGoogleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: gmailScopesString(),
    access_type: "offline",
    include_granted_scopes: "true",
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    prompt: options.prompt ?? "consent",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeAuthorizationCode(options: {
  code: string;
  codeVerifier: string;
}): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = requireGoogleConfig();

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: options.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: options.codeVerifier,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token exchange failed: ${body.slice(0, 300)}`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

export type GoogleTokenRefreshErrorKind = "auth_required" | "transient";

export class GoogleTokenRefreshError extends Error {
  readonly kind: GoogleTokenRefreshErrorKind;

  constructor(message: string, kind: GoogleTokenRefreshErrorKind) {
    super(message);
    this.name = "GoogleTokenRefreshError";
    this.kind = kind;
  }
}

export function classifyGoogleTokenRefreshFailure(
  status: number,
  body: string,
): GoogleTokenRefreshErrorKind {
  const lower = body.toLowerCase();

  if (
    lower.includes("invalid_grant") ||
    lower.includes("token has been expired or revoked") ||
    lower.includes("invalid_client") ||
    lower.includes("unauthorized_client")
  ) {
    return "auth_required";
  }

  if (
    status >= 500 ||
    status === 429 ||
    lower.includes("internal") ||
    lower.includes("temporarily unavailable") ||
    lower.includes("backend error")
  ) {
    return "transient";
  }

  return status >= 400 && status < 500 ? "auth_required" : "transient";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = requireGoogleConfig();

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    throw new GoogleTokenRefreshError(
      `Google token refresh failed: ${body.slice(0, 300)}`,
      classifyGoogleTokenRefreshFailure(response.status, body),
    );
  }

  return JSON.parse(body) as GoogleTokenResponse;
}

export async function refreshGoogleAccessTokenWithRetry(
  refreshToken: string,
  options?: { maxAttempts?: number },
): Promise<GoogleTokenResponse> {
  const maxAttempts = options?.maxAttempts ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await refreshGoogleAccessToken(refreshToken);
    } catch (error) {
      lastError = error;
      const isTransient =
        error instanceof GoogleTokenRefreshError &&
        error.kind === "transient";
      if (!isTransient || attempt === maxAttempts) {
        throw error;
      }
      await sleep(400 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Google token refresh failed.");
}

export async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to load Google user info: ${body.slice(0, 300)}`);
  }

  return (await response.json()) as GoogleUserInfo;
}

export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch {
    // Best-effort revoke — disconnect should still succeed locally.
  }
}
