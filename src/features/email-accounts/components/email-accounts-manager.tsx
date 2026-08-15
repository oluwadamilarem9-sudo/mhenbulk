"use client";

import { useActionState, useMemo, useTransition } from "react";
import Link from "next/link";

import {
  disconnectEmailAccountAction,
  sendAccountTestEmailAction,
} from "@/features/email-accounts/actions";
import type {
  EmailAccountActionState,
  EmailAccountPublic,
} from "@/features/email-accounts/schemas";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const initialTestState: EmailAccountActionState = {};

const linkButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

function statusBadge(status: EmailAccountPublic["status"]) {
  switch (status) {
    case "connected":
      return <Badge variant="success">Connected</Badge>;
    case "needs_reauth":
      return <Badge variant="warning">Needs reauthorization</Badge>;
    case "rate_limited":
      return <Badge variant="warning">Rate limited</Badge>;
    case "error":
      return <Badge variant="danger">Error</Badge>;
    default:
      return <Badge>Disconnected</Badge>;
  }
}

type EmailAccountsManagerProps = {
  accounts: EmailAccountPublic[];
  queryError?: string | null;
  flash?: { kind: "success" | "error"; message: string } | null;
};

export function EmailAccountsManager({
  accounts,
  queryError,
  flash,
}: EmailAccountsManagerProps) {
  const [busy, startTransition] = useTransition();
  const [testState, testAction, testPending] = useActionState(
    sendAccountTestEmailAction,
    initialTestState,
  );

  const gmailAccounts = useMemo(
    () => accounts.filter((account) => account.provider === "gmail"),
    [accounts],
  );

  function handleDisconnect(accountId: string) {
    if (
      !window.confirm(
        "Disconnect this Gmail account? Campaigns using it will not be able to send until you reconnect or choose another account.",
      )
    ) {
      return;
    }

    startTransition(async () => {
      await disconnectEmailAccountAction(accountId);
    });
  }

  return (
    <div className="space-y-6">
      {flash ? (
        <Alert variant={flash.kind === "error" ? "error" : "success"}>
          {flash.message}
        </Alert>
      ) : null}
      {queryError ? <Alert variant="error">{queryError}</Alert> : null}
      {testState.error ? <Alert variant="error">{testState.error}</Alert> : null}
      {testState.success ? (
        <Alert variant="success">{testState.success}</Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
          <CardDescription>
            Connect your Gmail account so campaign emails are sent as you — no
            Mhenbulk domain required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {gmailAccounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5">
              <p className="text-sm font-medium text-slate-900">Gmail</p>
              <p className="mt-1 text-sm text-slate-500">Not connected</p>
              <Link
                href="/api/auth/google/start"
                className={cn(
                  linkButtonClass,
                  "mt-4 bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:ring-indigo-500",
                )}
              >
                Connect Gmail
              </Link>
            </div>
          ) : (
            gmailAccounts.map((account) => (
              <div
                key={account.id}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Gmail</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      {account.display_name || "Gmail account"}
                    </p>
                    <a
                      href={`mailto:${account.email}`}
                      className="text-sm text-indigo-600 hover:underline"
                    >
                      {account.email}
                    </a>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {statusBadge(account.status)}
                      {account.last_error ? (
                        <span className="text-xs text-rose-600">
                          {account.last_error}
                        </span>
                      ) : null}
                    </div>
                    {account.status === "needs_reauth" ? (
                      <p className="mt-2 text-sm text-amber-700">
                        Your Gmail connection needs to be reauthorized.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {account.status === "needs_reauth" ||
                    account.status === "error" ? (
                      <Link
                        href="/api/auth/google/start"
                        className={cn(
                          linkButtonClass,
                          "bg-white text-slate-900 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 focus-visible:ring-indigo-500",
                        )}
                      >
                        Reconnect Gmail
                      </Link>
                    ) : null}
                    <Button
                      variant="ghost"
                      className="text-rose-600 hover:bg-rose-50"
                      disabled={busy}
                      onClick={() => handleDisconnect(account.id)}
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>

                {account.status === "connected" ||
                account.status === "rate_limited" ? (
                  <form
                    action={testAction}
                    className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
                  >
                    <input
                      type="hidden"
                      name="emailAccountId"
                      value={account.id}
                    />
                    <div className="space-y-2">
                      <Label htmlFor={`test-to-${account.id}`}>
                        Send test email
                      </Label>
                      <Input
                        id={`test-to-${account.id}`}
                        name="to"
                        type="email"
                        placeholder="test@example.com"
                        required
                      />
                      {testState.fieldErrors?.to?.[0] ? (
                        <p className="text-xs text-rose-600">
                          {testState.fieldErrors.to[0]}
                        </p>
                      ) : null}
                    </div>
                    <Button type="submit" disabled={testPending || busy}>
                      {testPending ? "Sending..." : "Send Test Email"}
                    </Button>
                  </form>
                ) : null}
              </div>
            ))
          )}

          <div className="pt-2">
            <Link
              href="/api/auth/google/start"
              className={cn(
                linkButtonClass,
                "bg-white text-slate-900 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 focus-visible:ring-indigo-500",
              )}
            >
              + Connect Gmail
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
