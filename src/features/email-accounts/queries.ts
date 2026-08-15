import { createClient } from "@/lib/supabase/server";
import type { EmailAccountPublic } from "@/features/email-accounts/schemas";

export async function listEmailAccounts(
  userId: string,
): Promise<{ accounts: EmailAccountPublic[]; error?: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("email_accounts")
    .select(
      "id, provider, email, display_name, status, rate_limited_until, last_error, last_used_at, created_at, updated_at",
    )
    .eq("user_id", userId)
    .neq("status", "disconnected")
    .order("created_at", { ascending: false });

  if (error) {
    return {
      accounts: [],
      error: "Unable to load connected email accounts.",
    };
  }

  return { accounts: (data ?? []) as EmailAccountPublic[] };
}

export async function getConnectedEmailAccounts(userId: string) {
  const { accounts } = await listEmailAccounts(userId);
  return accounts.filter(
    (account) =>
      account.status === "connected" || account.status === "rate_limited",
  );
}

export async function getEmailAccountForUser(
  userId: string,
  accountId: string,
): Promise<EmailAccountPublic | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("email_accounts")
    .select(
      "id, provider, email, display_name, status, rate_limited_until, last_error, last_used_at, created_at, updated_at",
    )
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  return (data as EmailAccountPublic | null) ?? null;
}
