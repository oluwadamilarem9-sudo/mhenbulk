import { redirect } from "next/navigation";

import { GmailCleanerPanel } from "@/features/gmail-cleaner/components/gmail-cleaner-panel";
import { getGmailCleanerPageData } from "@/features/gmail-cleaner/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function flashFromParams(params: Record<string, string | string[] | undefined>) {
  const error = one(params.error);
  const connected = one(params.connected);
  const mailbox = one(params.mailbox);
  if (error === "oauth_cancelled") {
    return {
      kind: "error" as const,
      message:
        "Google authorization was cancelled. Existing Gmail sending was not changed.",
    };
  }
  if (error === "oauth_failed" || error === "invalid_oauth_state") {
    return {
      kind: "error" as const,
      message: "Gmail authorization failed. Try again.",
    };
  }
  if (error === "google_not_configured" || error === "encryption_not_configured") {
    return {
      kind: "error" as const,
      message: "Gmail OAuth is not fully configured on the server.",
    };
  }
  if (error) {
    return {
      kind: "error" as const,
      message: "Gmail authorization could not be completed.",
    };
  }
  if (mailbox === "missing_modify") {
    return {
      kind: "error" as const,
      message:
        "Connected, but mailbox permission was not granted. Gmail Cleaner needs gmail.modify.",
    };
  }
  if (connected === "1") {
    return {
      kind: "success" as const,
      message:
        mailbox === "granted"
          ? "Gmail mailbox permission granted. You can start a scan."
          : "Gmail account connected.",
    };
  }
  return null;
}

export default async function GmailCleanerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/gmail-cleaner");

  const params = await searchParams;
  const data = await getGmailCleanerPageData(user.id, {
    accountId: one(params.accountId),
    scanId: one(params.scanId),
    category: one(params.category),
    q: one(params.q),
    action: one(params.action),
    operationId: one(params.operationId),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Gmail Cleaner
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Scan connected Gmail mailboxes, review rule-based clutter suggestions, and
          move approved messages to Trash. Nothing is trashed without your confirmation.
        </p>
      </div>

      <GmailCleanerPanel
        accounts={data.accounts}
        selectedAccountId={data.selectedAccountId}
        scan={data.scan}
        messages={data.messages}
        operations={data.operations}
        operationItems={data.operationItems}
        selectedOperationId={data.selectedOperationId}
        initialCategory={one(params.category)}
        initialQuery={one(params.q)}
        flash={flashFromParams(params)}
      />
    </div>
  );
}
