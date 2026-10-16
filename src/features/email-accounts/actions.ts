"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  testEmailSchema,
  type EmailAccountActionState,
} from "@/features/email-accounts/schemas";
import { saveMisarMailAccount } from "@/features/email-accounts/misarmail-account";
import { saveResendAccount } from "@/features/email-accounts/resend-account";
import { userFacingEmailError } from "@/lib/email/errors";
import { misarmailTestSendOptions, testSendSuccessMessage } from "@/lib/email/providers/misarmail";
import { resolveEmailProviderForAccount } from "@/lib/email/resolve-provider";
import { revokeGoogleToken } from "@/lib/google/oauth";
import { decryptSecret } from "@/lib/crypto/secrets";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid();

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function disconnectEmailAccountAction(
  accountId: string,
): Promise<EmailAccountActionState> {
  const idResult = uuidSchema.safeParse(accountId);
  if (!idResult.success) {
    return { error: "Invalid email account." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { data: account } = await supabase
    .from("email_accounts")
    .select("id, provider")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!account) {
    return { error: "Email account not found." };
  }

  if (account.provider === "gmail") {
    try {
      const service = createServiceRoleClient();
      const { data: credentials } = await service
        .from("email_account_credentials")
        .select("encrypted_refresh_token")
        .eq("email_account_id", account.id)
        .maybeSingle();

      if (credentials?.encrypted_refresh_token) {
        const refreshToken = decryptSecret(credentials.encrypted_refresh_token);
        await revokeGoogleToken(refreshToken);
      }

      await service
        .from("email_account_credentials")
        .delete()
        .eq("email_account_id", account.id);
    } catch (error) {
      console.error("[email-accounts] disconnect cleanup failed", error);
    }
  } else {
    try {
      const service = createServiceRoleClient();
      await service
        .from("email_account_credentials")
        .delete()
        .eq("email_account_id", account.id);
    } catch (error) {
      console.error("[email-accounts] disconnect cleanup failed", error);
    }
  }

  const { error } = await supabase
    .from("email_accounts")
    .update({
      status: "disconnected",
      last_error: null,
      token_expiry: null,
      rate_limited_until: null,
    })
    .eq("id", account.id)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Unable to disconnect this account." };
  }

  revalidatePath("/settings");
  revalidatePath("/settings/email-accounts");
  revalidatePath("/campaigns");
  return {
    success:
      account.provider === "misarmail"
        ? "MisarMail account disconnected."
        : account.provider === "resend"
          ? "Resend account disconnected."
          : "Gmail account disconnected.",
  };
}

const updateWarmupSchema = z.object({
  emailAccountId: z.string().uuid(),
  warmupEnabled: z.boolean(),
  dailyLimit: z.number().int().min(1).max(2000).nullable(),
});

export async function updateEmailAccountWarmupAction(
  payload: z.infer<typeof updateWarmupSchema>,
): Promise<EmailAccountActionState> {
  const parsed = updateWarmupSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid settings." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { warmupEnabled, dailyLimit, emailAccountId } = parsed.data;

  // Determine warmup_start_date: set it when enabling for the first time.
  let warmupStartDate: string | null | undefined = undefined;
  if (warmupEnabled) {
    const { data: existing } = await supabase
      .from("email_accounts")
      .select("warmup_start_date, warmup_enabled")
      .eq("id", emailAccountId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existing?.warmup_start_date || !existing.warmup_enabled) {
      warmupStartDate = new Date().toISOString().slice(0, 10);
    }
  }

  const { error } = await supabase
    .from("email_accounts")
    .update({
      warmup_enabled: warmupEnabled,
      daily_send_limit: dailyLimit,
      ...(warmupStartDate !== undefined ? { warmup_start_date: warmupStartDate } : {}),
    })
    .eq("id", emailAccountId)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Unable to save settings." };
  }

  revalidatePath("/settings/email-accounts");
  return { success: "Sending settings saved." };
}

export async function sendAccountTestEmailAction(
  _prev: EmailAccountActionState,
  formData: FormData,
): Promise<EmailAccountActionState> {
  const parsed = testEmailSchema.safeParse({
    emailAccountId: formData.get("emailAccountId"),
    to: formData.get("to"),
  });

  if (!parsed.success) {
    return {
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  let service;
  try {
    service = createServiceRoleClient();
  } catch {
    return {
      error:
        "Server is missing SUPABASE_SERVICE_ROLE_KEY required for Gmail sending.",
    };
  }

  const resolved = await resolveEmailProviderForAccount(
    service,
    user.id,
    parsed.data.emailAccountId,
  );

  if (!resolved.ok) {
    return { error: resolved.error };
  }

  const providerName = resolved.value.provider.name;
  const sandbox = providerName === "misarmail";
  const result = await resolved.value.provider.send({
    to: parsed.data.to,
    subject: sandbox ? "Mhenbulk sandbox check" : "Mhenbulk test email",
    html: sandbox
      ? `<p>Mhenbulk sandbox check for ${resolved.value.email}. This message is not delivered.</p>`
      : `<p>This is a test email sent through your connected ${providerName === "resend" ? "Resend" : "Gmail"} account <strong>${resolved.value.email}</strong> via Mhenbulk.</p>`,
    text: sandbox
      ? `Mhenbulk sandbox check for ${resolved.value.email}. This message is not delivered.`
      : `This is a test email sent through your connected ${providerName === "resend" ? "Resend" : "Gmail"} account ${resolved.value.email} via Mhenbulk.`,
    from: resolved.value.email,
    fromName: resolved.value.displayName ?? undefined,
    ...misarmailTestSendOptions(
      providerName,
      resolved.value.accountId,
      parsed.data.to,
    ),
  });

  if (!result.success) {
    return {
      error: userFacingEmailError(result.errorCode, result.error),
    };
  }

  await service
    .from("email_accounts")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", resolved.value.accountId)
    .eq("user_id", user.id);

  revalidatePath("/settings/email-accounts");
  return {
    success: testSendSuccessMessage(resolved.value.provider.name, parsed.data.to),
  };
}

function misarMailFormInput(formData: FormData) {
  return {
    email: String(formData.get("email") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    apiKey: String(formData.get("apiKey") ?? ""),
    accountId: String(formData.get("accountId") ?? "") || undefined,
  };
}

async function storeMisarMailAccount(
  formData: FormData,
): Promise<EmailAccountActionState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  let service;
  try {
    service = createServiceRoleClient();
  } catch {
    return { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY required to store the MisarMail key." };
  }

  const saved = await saveMisarMailAccount(
    supabase,
    service,
    user.id,
    misarMailFormInput(formData),
  );
  if (!saved.ok) {
    return { error: saved.error, fieldErrors: saved.fieldErrors };
  }

  revalidatePath("/settings");
  revalidatePath("/settings/email-accounts");
  revalidatePath("/campaigns");
  return { success: "MisarMail account connected." };
}

export async function connectMisarMailAccountAction(
  _prev: EmailAccountActionState,
  formData: FormData,
): Promise<EmailAccountActionState> {
  return storeMisarMailAccount(formData);
}

export async function updateMisarMailAccountAction(
  _prev: EmailAccountActionState,
  formData: FormData,
): Promise<EmailAccountActionState> {
  const saved = await storeMisarMailAccount(formData);
  if (saved.success) return { success: "MisarMail account updated." };
  return saved;
}

function resendFormInput(formData: FormData) {
  return {
    email: String(formData.get("email") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    apiKey: String(formData.get("apiKey") ?? ""),
    accountId: String(formData.get("accountId") ?? "") || undefined,
  };
}

async function storeResendAccount(
  formData: FormData,
): Promise<EmailAccountActionState> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  let service;
  try {
    service = createServiceRoleClient();
  } catch {
    return {
      error:
        "Server is missing SUPABASE_SERVICE_ROLE_KEY required to store the Resend key.",
    };
  }

  const saved = await saveResendAccount(
    supabase,
    service,
    user.id,
    resendFormInput(formData),
  );
  if (!saved.ok) {
    return { error: saved.error, fieldErrors: saved.fieldErrors };
  }

  revalidatePath("/settings");
  revalidatePath("/settings/email-accounts");
  revalidatePath("/campaigns");
  return { success: "Resend account connected." };
}

export async function connectResendAccountAction(
  _prev: EmailAccountActionState,
  formData: FormData,
): Promise<EmailAccountActionState> {
  return storeResendAccount(formData);
}

export async function updateResendAccountAction(
  _prev: EmailAccountActionState,
  formData: FormData,
): Promise<EmailAccountActionState> {
  const saved = await storeResendAccount(formData);
  if (saved.success) return { success: "Resend account updated." };
  return saved;
}
