import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL"),
});

const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required")
    .optional(),
  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  UNSUBSCRIBE_SECRET: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  EMAIL_ACCOUNT_ENCRYPTION_KEY: z.string().optional(),
  EMAIL_QUEUE_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),
  EMAIL_SEND_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(800),
  MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

function readPublicEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
}

export function getPublicEnv(): PublicEnv {
  const parsed = publicEnvSchema.safeParse(readPublicEnv());

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid public environment configuration: ${details}`);
  }

  return parsed.data;
}

export function getServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse({
    ...readPublicEnv(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? "console",
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    EMAIL_ACCOUNT_ENCRYPTION_KEY: process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY,
    EMAIL_QUEUE_BATCH_SIZE: process.env.EMAIL_QUEUE_BATCH_SIZE ?? "5",
    EMAIL_SEND_DELAY_MS: process.env.EMAIL_SEND_DELAY_MS ?? "800",
    MAX_RETRIES: process.env.MAX_RETRIES ?? "3",
  });

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`Invalid server environment configuration: ${details}`);
  }

  return parsed.data;
}

/** Safe for build-time imports when env may be unset. */
export function hasPublicSupabaseConfig(): boolean {
  return publicEnvSchema.safeParse(readPublicEnv()).success;
}

export function getQueueConfig() {
  return {
    batchSize: Number(process.env.EMAIL_QUEUE_BATCH_SIZE || 5),
    sendDelayMs: Number(process.env.EMAIL_SEND_DELAY_MS || 800),
    maxRetries: Number(process.env.MAX_RETRIES || 3),
  };
}
