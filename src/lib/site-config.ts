export const SITE_NAME = "Mhenbulk";
export const SITE_TAGLINE = "Send more. Reach more.";
export const LEGAL_LAST_UPDATED = "August 24, 2026";

export const DEFAULT_SUPPORT_EMAIL = "mhentor001@gmail.com";

/** Override with NEXT_PUBLIC_SUPPORT_EMAIL in production if needed. */
export function getSupportEmail(): string {
  return process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL;
}

export const GOVERNING_LAW_NOTICE =
  "These Terms will be governed by the applicable laws of the jurisdiction in which Mhenbulk is legally operated. This section may be updated as the legal operating entity and jurisdiction are finalized.";

export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://mhenbulk.vercel.app"
  );
}
