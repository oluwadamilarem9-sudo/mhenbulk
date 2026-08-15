/** Minimum Google scopes for Gmail-connected sending. */
export const GMAIL_SEND_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
  "profile",
] as const;

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export function gmailScopesString(): string {
  return GMAIL_SEND_SCOPES.join(" ");
}
