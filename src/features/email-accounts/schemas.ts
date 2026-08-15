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
};

export type EmailAccountActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[]>;
};
