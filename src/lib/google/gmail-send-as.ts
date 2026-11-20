/**
 * Gmail send-as (users.settings.sendAs) helpers for campaign From selection.
 * Listing requires gmail.modify (or gmail.settings.basic / mail.google.com).
 * Sending as a listed identity uses the existing gmail.send grant.
 */

export type GmailSendAsVerificationStatus =
  | "accepted"
  | "pending"
  | "failed"
  | "unspecified"
  | string;

export type GmailSendAsIdentity = {
  sendAsEmail: string;
  displayName: string | null;
  replyToAddress: string | null;
  isPrimary: boolean;
  isDefault: boolean;
  treatAsAlias: boolean;
  verificationStatus: GmailSendAsVerificationStatus | null;
};

export type UsableGmailSendAs = {
  email: string;
  displayName: string | null;
  replyToAddress: string | null;
  isPrimary: boolean;
  isDefault: boolean;
};

export class GmailSendAsError extends Error {
  readonly code:
    | "auth_required"
    | "forbidden"
    | "rate_limited"
    | "transient"
    | "provider_error";
  readonly status: number;

  constructor(
    message: string,
    code: GmailSendAsError["code"],
    status: number,
  ) {
    super(message);
    this.name = "GmailSendAsError";
    this.code = code;
    this.status = status;
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

type RawSendAs = {
  sendAsEmail?: string;
  displayName?: string;
  replyToAddress?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
  treatAsAlias?: boolean;
  verificationStatus?: string;
};

export function parseGmailSendAsIdentity(raw: RawSendAs): GmailSendAsIdentity | null {
  const sendAsEmail = raw.sendAsEmail?.trim();
  if (!sendAsEmail || !sendAsEmail.includes("@")) return null;
  return {
    sendAsEmail: normalizeEmail(sendAsEmail),
    displayName: raw.displayName?.trim() || null,
    replyToAddress: raw.replyToAddress?.trim()
      ? normalizeEmail(raw.replyToAddress)
      : null,
    isPrimary: Boolean(raw.isPrimary),
    isDefault: Boolean(raw.isDefault),
    treatAsAlias: Boolean(raw.treatAsAlias),
    verificationStatus: raw.verificationStatus?.trim() || null,
  };
}

/**
 * Primary identities are always usable. Custom aliases must be accepted by Google.
 */
export function isUsableGmailSendAs(identity: GmailSendAsIdentity): boolean {
  if (identity.isPrimary) return true;
  return identity.verificationStatus === "accepted";
}

export function toUsableGmailSendAs(
  identity: GmailSendAsIdentity,
): UsableGmailSendAs | null {
  if (!isUsableGmailSendAs(identity)) return null;
  return {
    email: identity.sendAsEmail,
    displayName: identity.displayName,
    replyToAddress: identity.replyToAddress,
    isPrimary: identity.isPrimary,
    isDefault: identity.isDefault,
  };
}

export function filterUsableGmailSendAs(
  identities: GmailSendAsIdentity[],
): UsableGmailSendAs[] {
  const usable: UsableGmailSendAs[] = [];
  const seen = new Set<string>();
  for (const identity of identities) {
    const next = toUsableGmailSendAs(identity);
    if (!next || seen.has(next.email)) continue;
    seen.add(next.email);
    usable.push(next);
  }
  usable.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
  return usable;
}

export function findUsableGmailSendAs(
  identities: GmailSendAsIdentity[],
  requestedEmail: string,
): UsableGmailSendAs | null {
  const wanted = normalizeEmail(requestedEmail);
  return (
    filterUsableGmailSendAs(identities).find((item) => item.email === wanted) ??
    null
  );
}

/**
 * Synthetic primary identity when sendAs.list is unavailable (send-only scope).
 */
export function primarySendAsFallback(
  email: string,
  displayName?: string | null,
): UsableGmailSendAs {
  return {
    email: normalizeEmail(email),
    displayName: displayName?.trim() || null,
    replyToAddress: null,
    isPrimary: true,
    isDefault: true,
  };
}

export async function listGmailSendAsIdentities(
  accessToken: string,
): Promise<GmailSendAsIdentity[]> {
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.ok) {
    const data = (await response.json()) as { sendAs?: RawSendAs[] };
    return (data.sendAs ?? [])
      .map(parseGmailSendAsIdentity)
      .filter((item): item is GmailSendAsIdentity => Boolean(item));
  }

  const body = await response.text();
  const lower = body.toLowerCase();

  if (response.status === 401) {
    throw new GmailSendAsError(
      "Gmail authorization is no longer valid.",
      "auth_required",
      response.status,
    );
  }

  if (response.status === 403) {
    throw new GmailSendAsError(
      lower.includes("insufficient") || lower.includes("scope")
        ? "This Gmail connection cannot list send-as aliases. Reconnect with mailbox permission (gmail.modify) to use domain aliases."
        : `Gmail refused send-as listing: ${body.slice(0, 200)}`,
      "forbidden",
      response.status,
    );
  }

  if (response.status === 429) {
    throw new GmailSendAsError(
      "Gmail rate limit while listing send-as aliases.",
      "rate_limited",
      response.status,
    );
  }

  if (response.status >= 500) {
    throw new GmailSendAsError(
      `Gmail temporarily unavailable (${response.status}).`,
      "transient",
      response.status,
    );
  }

  throw new GmailSendAsError(
    `Gmail send-as list failed (${response.status}): ${body.slice(0, 200)}`,
    "provider_error",
    response.status,
  );
}
