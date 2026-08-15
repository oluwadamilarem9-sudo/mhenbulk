"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  testEmailSchema,
  type EmailAccountActionState,
} from "@/features/email-accounts/schemas";
import { userFacingEmailError } from "@/lib/email/errors";
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

  // Best-effort revoke using service role (credentials are not readable via RLS).
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
  return { success: "Gmail account disconnected." };
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

  const result = await resolved.value.provider.send({
    to: parsed.data.to,
    subject: "Mhenbulk test email",
    html: `<p>This is a test email sent through your connected Gmail account <strong>${resolved.value.email}</strong> via Mhenbulk.</p>`,
    text: `This is a test email sent through your connected Gmail account ${resolved.value.email} via Mhenbulk.`,
    from: resolved.value.email,
    fromName: resolved.value.displayName ?? undefined,
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
  return { success: `Test email sent to ${parsed.data.to}.` };
}
