import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Resend webhook signatures (Svix format) without the svix dependency.
 * Scheme: base64(HMAC-SHA256(base64decode(secret), `${id}.${timestamp}.${payload}`)).
 */

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export function verifyWebhookSignature(input: {
  secret: string;
  payload: string;
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}): boolean {
  const { secret, payload, svixId, svixTimestamp, svixSignature } = input;

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  const timestamp = Number(svixTimestamp);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);
  if (ageSeconds > TIMESTAMP_TOLERANCE_SECONDS) {
    return false;
  }

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${payload}`;
  const expected = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  const expectedBuffer = Buffer.from(expected);

  // Header may contain several space-delimited signatures, e.g. "v1,abc v1,def".
  return svixSignature.split(" ").some((candidate) => {
    const value = candidate.includes(",") ? candidate.split(",")[1] : candidate;
    const candidateBuffer = Buffer.from(value ?? "");
    return (
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer)
    );
  });
}

export type ResendWebhookEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    subject?: string;
    bounce?: { type?: string; subType?: string; message?: string };
    click?: { link?: string };
  };
};
