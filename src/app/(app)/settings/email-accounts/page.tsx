import { redirect } from "next/navigation";

import { EmailAccountsManager } from "@/features/email-accounts/components/email-accounts-manager";
import { listEmailAccounts } from "@/features/email-accounts/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Email Accounts",
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function flashFromParams(params: Record<string, string | string[] | undefined>) {
  if (firstParam(params.connected) === "1") {
    return {
      kind: "success" as const,
      message: "Gmail connected successfully.",
    };
  }

  const error = firstParam(params.error);
  if (!error) return null;

  const messages: Record<string, string> = {
    oauth_cancelled: "Google authorization was cancelled.",
    invalid_oauth_state: "Google authorization failed. Please try again.",
    missing_refresh_token:
      "Google did not return a refresh token. Disconnect the app in your Google account, then connect again.",
    missing_email: "Google did not return an email address for this account.",
    google_not_configured:
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    encryption_not_configured:
      "EMAIL_ACCOUNT_ENCRYPTION_KEY is not configured on the server.",
    oauth_failed: "Unable to complete Google authorization. Please try again.",
    server_misconfigured:
      "Server configuration is invalid. Check the deployment environment variables and try again.",
  };

  return {
    kind: "error" as const,
    message: messages[error] ?? "Unable to connect Gmail. Please try again.",
  };
}

export default async function EmailAccountsPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const params = (await searchParams) ?? {};
  const { accounts, error } = await listEmailAccounts(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Email Accounts
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect your own Gmail account. Campaign emails are sent from that
          address — not from a Mhenbulk domain.
        </p>
      </div>

      <EmailAccountsManager
        accounts={accounts}
        queryError={error}
        flash={flashFromParams(params)}
      />
    </div>
  );
}
