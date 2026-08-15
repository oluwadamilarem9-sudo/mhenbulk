import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed unsubscribe tokens.
 * The token embeds only the contact id; contact/owner data is looked up
 * server-side when the public endpoint is hit.
 */

function getSecret(): string {
  const secret =
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!secret) {
    throw new Error("No secret available for signing unsubscribe tokens");
  }

  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function createUnsubscribeToken(contactId: string): string {
  const payload = Buffer.from(contactId, "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  try {
    const contactId = Buffer.from(payload, "base64url").toString("utf8");
    // Basic UUID sanity check.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId)) {
      return null;
    }
    return contactId;
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(contactId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/unsubscribe?token=${createUnsubscribeToken(contactId)}`;
}
