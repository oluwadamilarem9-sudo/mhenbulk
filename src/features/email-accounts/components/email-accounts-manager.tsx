"use client";

import { useActionState, useMemo, useOptimistic, useTransition } from "react";
import Link from "next/link";

import {
  disconnectEmailAccountAction,
  sendAccountTestEmailAction,
  updateEmailAccountWarmupAction,
} from "@/features/email-accounts/actions";
import type {
  EmailAccountActionState,
  EmailAccountPublic,
} from "@/features/email-accounts/schemas";
import {
  getEffectiveDailyLimit,
  getWarmupStageLabel,
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

function WarmupPanel({ account }: { account: EmailAccountPublic }) {
  const [saving, startSave] = useTransition();
  const [saveMsg, setSaveMsg] = useOptimistic<string | null>(null);

  const effectiveLimit = getEffectiveDailyLimit(account);
  // Normalise today_sent to today (may be stale if reset hasn't run yet).
  const todaySent = account.today_sent_count ?? 0;
  const pct = effectiveLimit ? Math.min(100, Math.round((todaySent / effectiveLimit) * 100)) : 0;

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const warmupEnabled = fd.get("warmup_enabled") === "on";
    const rawLimit = fd.get("daily_limit");
    const dailyLimit = rawLimit ? parseInt(String(rawLimit), 10) || null : null;

    startSave(async () => {
      setSaveMsg("Saving…");
      const result = await updateEmailAccountWarmupAction({
        emailAccountId: account.id,
        warmupEnabled,
        dailyLimit,
      });
      setSaveMsg(result.error ?? result.success ?? null);
    });
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-4">
      <p className="text-sm font-semibold text-slate-700">Daily sending limits</p>

      {/* Daily quota bar */}
      {effectiveLimit !== null ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Today: <span className="font-medium text-slate-700">{todaySent}</span> / {effectiveLimit} sent</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-400" : "bg-indigo-500",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          {account.warmup_enabled && account.warmup_start_date ? (
            <p className="text-xs text-indigo-600">
              Warm-up active — {getWarmupStageLabel(account.warmup_start_date)}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No daily limit set — sending as fast as Gmail allows.</p>
      )}

      {/* Settings form */}
      <form onSubmit={handleSave} className="space-y-3">
        <div className="flex items-center gap-3">
          <input
            id={`warmup-${account.id}`}
            name="warmup_enabled"
            type="checkbox"
            defaultChecked={account.warmup_enabled}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
          />
          <label htmlFor={`warmup-${account.id}`} className="text-sm text-slate-700 cursor-pointer">
            Enable warm-up schedule (auto-increase limit over 5 weeks)
          </label>
        </div>

        <div className="flex items-end gap-3">
          <div className="space-y-1 flex-1">
            <Label htmlFor={`limit-${account.id}`} className="text-xs text-slate-600">
              Manual daily limit (leave blank = no cap)
            </Label>
            <Input
              id={`limit-${account.id}`}
              name="daily_limit"
              type="number"
              min={1}
              max={2000}
              defaultValue={account.daily_send_limit ?? ""}
              placeholder="e.g. 300"
              className="h-8 text-sm"
            />
          </div>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>

        {saveMsg ? (
          <p className={cn("text-xs", saveMsg.startsWith("Unable") ? "text-rose-600" : "text-emerald-600")}>
            {saveMsg}
          </p>
        ) : null}
      </form>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs font-medium text-amber-800">💡 Deliverability tip</p>
        <p className="mt-1 text-xs text-amber-700">
          Gmail personal accounts are flagged for bulk sending. Enable warm-up and keep limits low (50–150/day) to avoid spam. For best results, use a custom domain with Google Workspace.
        </p>
      </div>
    </div>
  );
}

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

                <WarmupPanel account={account} />

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
