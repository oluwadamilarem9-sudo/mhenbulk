/** Minimum Google scopes for Gmail-connected sending. */
export const GMAIL_SEND_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
  "profile",
] as const;

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/**
 * Restricted Gmail scope required to list/read metadata and move messages to Trash.
 * Production use typically requires Google OAuth verification (and may require a
 * security assessment). Existing send-only connections do not gain this automatically.
 */
export const GMAIL_MODIFY_SCOPE =
  "https://www.googleapis.com/auth/gmail.modify";

/** Scopes requested when connecting or upgrading for Gmail Cleaner. */
export const GMAIL_CLEANER_SCOPES = [
  ...GMAIL_SEND_SCOPES,
  GMAIL_MODIFY_SCOPE,
] as const;

export type GmailOAuthIntent = "send" | "cleaner";

export function gmailScopesString(
  intent: GmailOAuthIntent = "send",
): string {
  return (intent === "cleaner" ? GMAIL_CLEANER_SCOPES : GMAIL_SEND_SCOPES).join(
    " ",
  );
}

export function normalizeGoogleScopes(
  scopes: string[] | string | null | undefined,
): string[] {
  const raw =
    typeof scopes === "string"
      ? scopes.split(/\s+/)
      : Array.isArray(scopes)
        ? scopes
        : [];
  return [...new Set(raw.map((scope) => scope.trim()).filter(Boolean))];
}

/** Preserve previously granted scopes when Google returns a partial set. */
export function mergeGoogleScopes(
  existing: string[] | string | null | undefined,
  incoming: string[] | string | null | undefined,
): string[] {
  return normalizeGoogleScopes([
    ...normalizeGoogleScopes(existing),
    ...normalizeGoogleScopes(incoming),
  ]);
}

export function hasGmailModifyScope(
  scopes: string[] | string | null | undefined,
): boolean {
  const normalized = normalizeGoogleScopes(scopes);
  return (
    normalized.includes(GMAIL_MODIFY_SCOPE) ||
    normalized.includes("https://mail.google.com/")
  );
}

/** Scopes that can call users.settings.sendAs.list (per Google docs). */
export function hasGmailSendAsListScope(
  scopes: string[] | string | null | undefined,
): boolean {
  const normalized = normalizeGoogleScopes(scopes);
  return (
    hasGmailModifyScope(normalized) ||
    normalized.includes("https://www.googleapis.com/auth/gmail.settings.basic") ||
    normalized.includes("https://www.googleapis.com/auth/gmail.readonly")
  );
}
