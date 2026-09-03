import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed open-tracking tokens for Gmail-sent campaigns.
 * Payload is campaign_recipient_id only; ownership is resolved server-side.
 */

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "UNSUBSCRIBE_SECRET is required (32+ characters) for open tracking.",
    );
  }

  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret())
    .update(`open:${payload}`)
    .digest("base64url");
}

export function createOpenTrackToken(recipientId: string): string {
  const payload = Buffer.from(recipientId, "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyOpenTrackToken(token: string): string | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  try {
    const recipientId = Buffer.from(payload, "base64url").toString("utf8");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        recipientId,
      )
    ) {
      return null;
    }
    return recipientId;
  } catch {
    return null;
  }
}

export function buildOpenTrackUrl(recipientId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/t/o?t=${createOpenTrackToken(recipientId)}`;
}

/** Append a 1×1 open pixel to HTML without changing visible content. */
export function appendOpenTrackPixel(html: string, recipientId: string): string {
  const pixel = `<img src="${buildOpenTrackUrl(recipientId)}" width="1" height="1" alt="" style="display:none!important;width:1px!important;height:1px!important;border:0;" />`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return `${html}${pixel}`;
}
