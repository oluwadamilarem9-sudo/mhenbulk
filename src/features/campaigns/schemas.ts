import { z } from "zod";

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

/** Subject falls back to the campaign name when left blank. */
export function resolveCampaignSubject(name: string, subject?: string | null): string {
  const trimmed = subject?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : name;
}

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
