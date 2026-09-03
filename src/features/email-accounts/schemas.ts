import { z } from "zod";

import type { EmailAccountStatus } from "@/lib/supabase/database.types";

export const testEmailSchema = z.object({
  emailAccountId: z.string().uuid("Invalid email account."),
  to: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(320, "Email is too long"),
});

export type EmailAccountPublic = {
  id: string;
  provider: "gmail" | "outlook" | "smtp" | "resend";
  email: string;
  display_name: string | null;
  status: EmailAccountStatus;
  rate_limited_until: string | null;
  last_error: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  // Warm-up / daily limit
  daily_send_limit: number | null;
  today_sent_count: number;
  last_count_reset_date: string | null;
  warmup_enabled: boolean;
  warmup_start_date: string | null;
};

/** Computes the effective daily limit for display purposes (warm-up overrides manual). */
export function getEffectiveDailyLimit(account: Pick<EmailAccountPublic, "daily_send_limit" | "warmup_enabled" | "warmup_start_date">): number | null {
  let limit = account.daily_send_limit;

  if (account.warmup_enabled && account.warmup_start_date) {
    const start = new Date(account.warmup_start_date).getTime();
    const days = Math.floor((Date.now() - start) / 86_400_000);
    const wuLimit =
      days < 8  ? 30  :
      days < 15 ? 75  :
      days < 22 ? 150 :
      days < 29 ? 250 :
      days < 36 ? 400 :
      null;
    if (wuLimit !== null) {
      limit = limit === null ? wuLimit : Math.min(limit, wuLimit);
    }
  }

  return limit;
}

/** Label for the current warm-up stage. */
export function getWarmupStageLabel(warmupStartDate: string): string {
  const start = new Date(warmupStartDate).getTime();
  const days = Math.floor((Date.now() - start) / 86_400_000);
  if (days < 8)  return "Week 1 — 30/day";
  if (days < 15) return "Week 2 — 75/day";
  if (days < 22) return "Week 3 — 150/day";
  if (days < 29) return "Week 4 — 250/day";
  if (days < 36) return "Week 5 — 400/day";
  return "Warm-up complete";
}

export type EmailAccountActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
};
