/**
 * Gmail send-as (users.settings.sendAs) helpers for campaign From selection.
 * Listing requires gmail.modify, gmail.settings.basic, gmail.readonly, or mail.google.com.
 * Sending as a listed identity uses the existing gmail.send grant.
 */

export type GmailSendAsVerificationStatus =
  | "accepted"
  | "pending"
  | "failed"
  | "unspecified"
  | "unknown"
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

export type SendAsExclusionReason =
  | "verified"
  | "primary"
  | "verification_pending"
  | "verification_rejected"
  | "verification_unspecified"
  | "verification_unknown"
  | "invalid_address";

export type SendAsInventoryItem = {
  email: string;
  displayName: string | null;
  replyToAddress: string | null;
  isPrimary: boolean;
  isDefault: boolean;
  treatAsAlias: boolean;
  verificationStatus: string | null;
  usable: boolean;
  statusLabel: string;
  exclusionReason: SendAsExclusionReason;
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

export function normalizeVerificationStatus(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "accepted" ||
    normalized === "verificationstatus_accepted"
  ) {
    return "accepted";
  }
  if (
    normalized === "pending" ||
    normalized === "verificationstatus_pending"
  ) {
    return "pending";
  }
  if (
    normalized === "failed" ||
    normalized === "verificationstatus_failed"
  ) {
    return "failed";
  }
  if (
    normalized === "unspecified" ||
    normalized === "verificationstatusunspecified" ||
    normalized === "verification_status_unspecified"
  ) {
    return "unspecified";
  }
  return normalized;
}

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
    verificationStatus: normalizeVerificationStatus(raw.verificationStatus),
  };
}

/**
 * Primary identities are always usable. Custom aliases must be accepted by Google.
 * verificationStatus is normalized case-insensitively ("accepted" / "ACCEPTED").
 */
export function isUsableGmailSendAs(identity: GmailSendAsIdentity): boolean {
  if (identity.isPrimary) return true;
  return normalizeVerificationStatus(identity.verificationStatus) === "accepted";
}

export function describeSendAsUsability(
  identity: GmailSendAsIdentity,
): SendAsInventoryItem {
  const status = normalizeVerificationStatus(identity.verificationStatus);
  if (!identity.sendAsEmail.includes("@")) {
    return {
      email: identity.sendAsEmail,
      displayName: identity.displayName,
      replyToAddress: identity.replyToAddress,
      isPrimary: identity.isPrimary,
      isDefault: identity.isDefault,
      treatAsAlias: identity.treatAsAlias,
      verificationStatus: status,
      usable: false,
      statusLabel: "Invalid address",
      exclusionReason: "invalid_address",
    };
  }
  if (identity.isPrimary) {
    return {
      email: identity.sendAsEmail,
      displayName: identity.displayName,
      replyToAddress: identity.replyToAddress,
      isPrimary: true,
      isDefault: identity.isDefault,
      treatAsAlias: identity.treatAsAlias,
      verificationStatus: status,
      usable: true,
      statusLabel: "Verified and available (primary)",
      exclusionReason: "primary",
    };
  }
  if (status === "accepted") {
    return {
      email: identity.sendAsEmail,
      displayName: identity.displayName,
      replyToAddress: identity.replyToAddress,
      isPrimary: false,
      isDefault: identity.isDefault,
      treatAsAlias: identity.treatAsAlias,
      verificationStatus: status,
      usable: true,
      statusLabel: "Verified and available",
      exclusionReason: "verified",
    };
  }
  if (status === "pending") {
    return {
      email: identity.sendAsEmail,
      displayName: identity.displayName,
      replyToAddress: identity.replyToAddress,
      isPrimary: false,
      isDefault: identity.isDefault,
      treatAsAlias: identity.treatAsAlias,
      verificationStatus: status,
      usable: false,
      statusLabel: "Verification pending in Gmail",
      exclusionReason: "verification_pending",
    };
  }
  if (status === "failed") {
    return {
      email: identity.sendAsEmail,
      displayName: identity.displayName,
      replyToAddress: identity.replyToAddress,
      isPrimary: false,
      isDefault: identity.isDefault,
      treatAsAlias: identity.treatAsAlias,
      verificationStatus: status,
      usable: false,
      statusLabel: "Verification rejected in Gmail",
      exclusionReason: "verification_rejected",
    };
  }
  if (status === "unspecified") {
    return {
      email: identity.sendAsEmail,
      displayName: identity.displayName,
      replyToAddress: identity.replyToAddress,
      isPrimary: false,
      isDefault: identity.isDefault,
      treatAsAlias: identity.treatAsAlias,
      verificationStatus: status,
      usable: false,
      statusLabel: "Verification unspecified — not offered for sending",
      exclusionReason: "verification_unspecified",
    };
  }
  return {
    email: identity.sendAsEmail,
    displayName: identity.displayName,
    replyToAddress: identity.replyToAddress,
    isPrimary: false,
    isDefault: identity.isDefault,
    treatAsAlias: identity.treatAsAlias,
    verificationStatus: status,
    usable: false,
    statusLabel: status
      ? `Not usable (verificationStatus=${status})`
      : "Not returned as verified by Gmail",
    exclusionReason: "verification_unknown",
  };
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

export function buildSendAsInventory(
  identities: GmailSendAsIdentity[],
): SendAsInventoryItem[] {
  const seen = new Set<string>();
  const items: SendAsInventoryItem[] = [];
  for (const identity of identities) {
    if (seen.has(identity.sendAsEmail)) continue;
    seen.add(identity.sendAsEmail);
    items.push(describeSendAsUsability(identity));
  }
  return items.sort((a, b) => {
    if (a.usable !== b.usable) return a.usable ? -1 : 1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
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

export type ListGmailSendAsResult = {
  identities: GmailSendAsIdentity[];
  httpStatus: number;
};

export async function listGmailSendAsIdentities(
  accessToken: string,
): Promise<GmailSendAsIdentity[]> {
  const result = await listGmailSendAsIdentitiesWithStatus(accessToken);
  return result.identities;
}

export async function listGmailSendAsIdentitiesWithStatus(
  accessToken: string,
): Promise<ListGmailSendAsResult> {
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
    return {
      httpStatus: response.status,
      identities: (data.sendAs ?? [])
        .map(parseGmailSendAsIdentity)
        .filter((item): item is GmailSendAsIdentity => Boolean(item)),
    };
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
      lower.includes("insufficient") ||
        lower.includes("scope") ||
        lower.includes("access_token_scope_insufficient")
        ? "Gmail rejected send-as listing: this account's OAuth token does not include mailbox permission (gmail.modify). Use “Grant send-as permission” and approve mailbox access for this exact Gmail account, then reload the campaign form."
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
