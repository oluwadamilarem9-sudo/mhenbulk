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
  EMAIL_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
  EMAIL_SEND_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(800),
  MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
  EMAIL_FINDER_MAX_SCANS_PER_HOUR: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20),
  EMAIL_FINDER_MAX_PAGES_PER_SCAN: z.coerce
    .number()
    .int()
    .min(1)
    .max(25)
    .default(10),
  EMAIL_FINDER_REQUEST_TIMEOUT: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(20_000)
    .default(8_000),
  EMAIL_FINDER_MAX_RESPONSE_SIZE: z.coerce
    .number()
    .int()
    .min(50_000)
    .max(2_000_000)
    .default(1_000_000),
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

/** Deployment dashboards often store values wrapped in quotes. */
function unquote(value: string | undefined): string | undefined {
  return value?.trim().replace(/^["']|["']$/g, "");
}

/**
 * EMAIL_PROVIDER is a legacy local/dev fallback. An unrecognized value must
 * never break Gmail-connected sending, so unknown values degrade to console.
 */
function readEmailProvider(): "console" | "resend" {
  return unquote(process.env.EMAIL_PROVIDER)?.toLowerCase() === "resend"
    ? "resend"
    : "console";
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
    EMAIL_PROVIDER: readEmailProvider(),
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: unquote(process.env.EMAIL_FROM),
    UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    EMAIL_ACCOUNT_ENCRYPTION_KEY: process.env.EMAIL_ACCOUNT_ENCRYPTION_KEY,
    EMAIL_QUEUE_BATCH_SIZE: unquote(process.env.EMAIL_QUEUE_BATCH_SIZE) || "5",
    EMAIL_QUEUE_CONCURRENCY:
      unquote(process.env.EMAIL_QUEUE_CONCURRENCY) || "1",
    EMAIL_SEND_DELAY_MS: unquote(process.env.EMAIL_SEND_DELAY_MS) || "800",
    MAX_RETRIES: unquote(process.env.MAX_RETRIES) || "3",
    EMAIL_FINDER_MAX_SCANS_PER_HOUR:
      unquote(process.env.EMAIL_FINDER_MAX_SCANS_PER_HOUR) || "20",
    EMAIL_FINDER_MAX_PAGES_PER_SCAN:
      unquote(process.env.EMAIL_FINDER_MAX_PAGES_PER_SCAN) || "10",
    EMAIL_FINDER_REQUEST_TIMEOUT:
      unquote(process.env.EMAIL_FINDER_REQUEST_TIMEOUT) || "8000",
    EMAIL_FINDER_MAX_RESPONSE_SIZE:
      unquote(process.env.EMAIL_FINDER_MAX_RESPONSE_SIZE) || "1000000",
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
    concurrency: Number(process.env.EMAIL_QUEUE_CONCURRENCY || 1),
    sendDelayMs: Number(process.env.EMAIL_SEND_DELAY_MS || 800),
    maxRetries: Number(process.env.MAX_RETRIES || 3),
  };
}
