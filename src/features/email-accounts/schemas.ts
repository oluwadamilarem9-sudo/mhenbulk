import { z } from "zod";

import {
  effectiveDailySendLimit,
  warmupStageLabel,
} from "@/lib/email/daily-limit";
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

/** Daily cap shown in settings. A typed limit wins over warm-up. */
export function getEffectiveDailyLimit(
  account: Pick<
    EmailAccountPublic,
    "daily_send_limit" | "warmup_enabled" | "warmup_start_date"
  >,
): number | null {
  return effectiveDailySendLimit(account);
}

/** Label for the current warm-up stage. */
export function getWarmupStageLabel(warmupStartDate: string): string {
  return warmupStageLabel(warmupStartDate);
}

export type EmailAccountActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
};
