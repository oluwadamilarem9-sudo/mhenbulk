/**
 * Transparent confidence scoring for publicly discovered addresses.
 * This is not a deliverability guarantee — only how strongly the page evidence
 * suggests a real, human-facing contact address.
 */

import type { EmailFinderCategory } from "@/lib/supabase/database.types";

export type EmailFinderConfidence = "high" | "medium" | "low";

export type ExtractionMethod =
  | "mailto"
  | "visible_text"
  | "raw_html"
  | "json_ld"
  | "meta"
  | "obfuscated"
  | "cloudflare";

/** Role inboxes that owner-grade mode hides. Kept as business/generic otherwise. */
export const OWNER_GRADE_EXCLUDED_LOCALS = new Set([
  "info",
  "hello",
  "hi",
  "contact",
  "contacts",
  "support",
  "help",
  "sales",
  "admin",
  "office",
  "service",
  "customerservice",
  "customer-service",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "webmaster",
  "postmaster",
  "privacy",
  "legal",
  "mailer-daemon",
  "newsletter",
  "notifications",
  "notification",
  "billing",
  "accounts",
  "marketing",
  "press",
  "media",
  "team",
]);

const TEAM_PATH = /\/(team|our-team|staff|people|leadership|ueber-uns|about)/i;
const CONTACT_PATH = /\/(contact|kontakt|get-in-touch|reach-us|impressum|imprint)/i;
const LEGAL_PATH = /\/(privacy|datenschutz|terms|legal|policy|policies)/i;

export function isOwnerGradeEmail(
  email: string,
  category: EmailFinderCategory,
): boolean {
  if (category === "generic") return false;
  const local = (email.split("@")[0] ?? "").toLowerCase();
  const compact = local.replace(/[._\-]/g, "");
  if (OWNER_GRADE_EXCLUDED_LOCALS.has(local) || OWNER_GRADE_EXCLUDED_LOCALS.has(compact)) {
    return false;
  }
  if (local.startsWith("noreply") || local.startsWith("no-reply")) return false;
  return category === "personal" || !OWNER_GRADE_EXCLUDED_LOCALS.has(compact);
}

export function scoreEmailConfidence(input: {
  email: string;
  category: EmailFinderCategory;
  sourceUrls: string[];
  methods: ExtractionMethod[];
}): EmailFinderConfidence {
  let score = 40;
  const local = (input.email.split("@")[0] ?? "").toLowerCase();
  const sources = input.sourceUrls.map((url) => url.toLowerCase());

  if (input.category === "personal") score += 25;
  if (input.category === "generic") score -= 30;
  if (input.methods.includes("mailto")) score += 20;
  if (input.methods.includes("json_ld")) score += 10;
  if (input.methods.includes("cloudflare")) score += 8;
  if (input.methods.includes("obfuscated")) score += 5;
  if (input.sourceUrls.length >= 2) score += 15;
  if (input.sourceUrls.length >= 3) score += 10;

  if (sources.some((url) => TEAM_PATH.test(url))) score += 18;
  if (sources.some((url) => CONTACT_PATH.test(url))) score += 12;
  if (sources.every((url) => LEGAL_PATH.test(url))) score -= 20;

  if (
    OWNER_GRADE_EXCLUDED_LOCALS.has(local) ||
    OWNER_GRADE_EXCLUDED_LOCALS.has(local.replace(/[._\-]/g, ""))
  ) {
    score -= 8;
  }

  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  return "low";
}
