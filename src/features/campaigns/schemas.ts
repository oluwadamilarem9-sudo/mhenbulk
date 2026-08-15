import { z } from "zod";

/**
 * Postgres still has campaigns_subject_check (non-empty). Until migration
 * 0003 is applied, blank subjects are stored as a zero-width space so the
 * row saves; MIME send strips it so recipients see "no subject".
 */
export const BLANK_SUBJECT_PLACEHOLDER = "\u200B";

export function subjectForStorage(subject?: string | null): string {
  const trimmed = subject?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : BLANK_SUBJECT_PLACEHOLDER;
}

export function subjectForSend(subject?: string | null): string {
  return (subject ?? "").replaceAll(BLANK_SUBJECT_PLACEHOLDER, "").trim();
}

export function subjectForDisplay(subject?: string | null): string {
  const visible = subjectForSend(subject);
  return visible.length > 0 ? visible : "(no subject)";
}

export const campaignSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Campaign name is required")
    .max(200, "Campaign name is too long"),
  subject: z
    .string()
    .trim()
    .max(300, "Subject is too long")
    .optional()
    .or(z.literal("")),
  htmlContent: z
    .string()
    .trim()
    .min(1, "Email message is required")
    .max(200_000, "Email message is too large")
    .refine(
      (html) =>
        html
          .replace(/<[^>]*>/g, "")
          .replace(/&nbsp;/gi, " ")
          .trim().length > 0,
      "Email message is required",
    ),
  textContent: z
    .string()
    .trim()
    .max(100_000, "Plain-text version is too large")
    .optional()
    .or(z.literal("")),
  emailAccountId: z.string().uuid("Select a connected sending account"),
});

export const campaignTestEmailSchema = z.object({
  campaignId: z.string().uuid(),
  to: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(320, "Email is too long"),
});

export type CampaignInput = z.infer<typeof campaignSchema>;

export type CampaignActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
  campaignId?: string;
};

export type QueueBatchResult = {
  error?: string;
  processed?: number;
  sent?: number;
  failed?: number;
  skipped?: number;
  retriesScheduled?: number;
  remaining?: number;
  campaignStatus?: string;
};
