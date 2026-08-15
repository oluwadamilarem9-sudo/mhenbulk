"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, Pause, Play, Send, Trash2, XCircle } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelCampaignAction,
  deleteCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  sendTestEmailAction,
  startCampaignAction,
} from "@/features/campaigns/actions";
import { CampaignForm } from "@/features/campaigns/components/campaign-form";
import { CampaignRecipientsPanel } from "@/features/campaigns/components/campaign-recipients-panel";
import { CampaignSequencePanel } from "@/features/campaigns/components/campaign-sequence-panel";
import { CampaignStatusBadge } from "@/features/campaigns/components/campaign-status-badge";
import { processQueueBatchAction } from "@/features/campaigns/queue-actions";
import type { CampaignWorkspaceData } from "@/features/campaigns/queries";
import type { CampaignActionState } from "@/features/campaigns/schemas";
import { subjectForDisplay } from "@/features/campaigns/schemas";
import type { EmailAccountPublic } from "@/features/email-accounts/schemas";
import { formatNumber } from "@/lib/utils";

export const CAMPAIGN_TABS = [
  "overview",
  "recipients",
  "sequence",
  "activity",
  "analytics",
  "settings",
] as const;
export type CampaignTab = (typeof CAMPAIGN_TABS)[number];

type Props = {
  data: CampaignWorkspaceData;
  activeTab: CampaignTab;
  accounts: EmailAccountPublic[];
  previewHtml: string;
  senderLabel: string | null;
};

const initialState: CampaignActionState = {};

export function CampaignWorkspace({
  data,
  activeTab,
  accounts,
  previewHtml,
  senderLabel,
}: Props) {
  const { campaign, stats } = data;
  const router = useRouter();
  const [message, setMessage] = useState<CampaignActionState | null>(null);
  const [busy, startTransition] = useTransition();
  const [testState, testAction, testPending] = useActionState(sendTestEmailAction, initialState);
  const processingRef = useRef(false);
  const isDraft = campaign.status === "draft";
  const isSending = campaign.status === "sending";
  const isScheduled = campaign.status === "scheduled";
  const isPaused = campaign.status === "paused";

  const runQueueBatch = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      const result = await processQueueBatchAction(campaign.id);
      if (result.error) setMessage({ error: result.error });
      router.refresh();
    } finally {
      processingRef.current = false;
    }
  }, [campaign.id, router]);

  useEffect(() => {
    if (!isSending) return;
    void runQueueBatch();
    const interval = window.setInterval(() => void runQueueBatch(), 4000);
    return () => window.clearInterval(interval);
  }, [isSending, runQueueBatch]);

  const progress = useMemo(
    () =>
      stats.total
        ? Math.round(((stats.sent + stats.failed + stats.skipped) / stats.total) * 100)
        : 0,
    [stats],
  );

  function run(action: () => Promise<CampaignActionState>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      setMessage(result);
      if (!result.error) onSuccess?.();
      router.refresh();
    });
  }

  function launch() {
    if (!data.members.length) {
      setMessage({ error: "Enroll at least one recipient before launching." });
      return;
    }
    if (!window.confirm(`Launch this campaign to ${data.members.length} enrolled recipient(s)?`)) return;
    run(() => startCampaignAction(campaign.id, "all"));
  }

  function removeCampaign() {
    if (!window.confirm(`Delete campaign "${campaign.name}"? This cannot be undone.`)) return;
    run(() => deleteCampaignAction(campaign.id), () => router.push("/campaigns"));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {campaign.name}
            </h1>
            <CampaignStatusBadge status={campaign.status} />
            {campaign.automation_enabled ? <Badge variant="info">Automation on</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Subject: {subjectForDisplay(campaign.subject)}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Sender: {senderLabel ?? "No Gmail sender connected"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isDraft ? (
            <Button onClick={launch} disabled={busy || !senderLabel || data.members.length === 0}>
              <Send className="h-4 w-4" />
              Launch to {data.members.length}
            </Button>
          ) : null}
          {isSending || isScheduled || isPaused ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run(() =>
                  isSending || isScheduled
                    ? pauseCampaignAction(campaign.id)
                    : resumeCampaignAction(campaign.id),
                )
              }
            >
              {isSending || isScheduled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isSending || isScheduled ? "Pause" : "Resume"}
            </Button>
          ) : null}
          {isSending || isScheduled || isPaused ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Cancel remaining queued emails? Sent messages cannot be recalled.")) {
                  run(() => cancelCampaignAction(campaign.id));
                }
              }}
            >
              <XCircle className="h-4 w-4" />
              Cancel
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="text-rose-600"
            disabled={busy || isSending}
            onClick={removeCampaign}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {(message?.error || message?.success) ? (
        <Alert variant={message.error ? "error" : "success"}>
          {message.error ?? message.success}
        </Alert>
      ) : null}
      {campaign.pause_reason ? (
        <Alert variant="warning">
          Campaign paused: {campaign.pause_reason.replaceAll("_", " ")}.
          {campaign.pause_reason === "auth_required" ? (
            <> <Link className="underline" href="/settings/email-accounts">Reconnect Gmail</Link>.</>
          ) : null}
        </Alert>
      ) : null}

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Campaign workspace">
        {CAMPAIGN_TABS.map((tab) => (
          <Link
            key={tab}
            href={`/campaigns/${campaign.id}?tab=${tab}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium capitalize ${
              activeTab === tab
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {tab}
          </Link>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Enrolled" value={data.members.length} />
            <Metric label="Queued/sent records" value={stats.total} />
            <Metric label="Accepted by Gmail" value={stats.sent} />
            <Metric label="Replies recorded" value={data.replies} />
          </div>
          {!isDraft ? (
            <Card>
              <CardHeader>
                <CardTitle>Delivery progress</CardTitle>
                <CardDescription>
                  Accepted means Gmail accepted the send; it does not guarantee inbox delivery.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-indigo-600" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-2 text-sm text-slate-500">{progress}% processed</p>
              </CardContent>
            </Card>
          ) : null}
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Send a test</CardTitle>
                <CardDescription>Uses the connected sender and does not enroll the address.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {testState.error ? <Alert variant="error">{testState.error}</Alert> : null}
                {testState.success ? <Alert variant="success">{testState.success}</Alert> : null}
                <form action={testAction} className="flex gap-2">
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <div className="flex-1">
                    <Label htmlFor="test-recipient">Recipient</Label>
                    <Input id="test-recipient" name="to" type="email" required />
                  </div>
                  <Button type="submit" className="self-end" disabled={testPending || !senderLabel}>
                    {testPending ? "Sending..." : "Send test"}
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Email preview</CardTitle>
                <CardDescription>Rendered with sample personalization.</CardDescription>
              </CardHeader>
              <CardContent>
                <iframe title="Email preview" srcDoc={previewHtml} sandbox="" className="h-80 w-full rounded-lg border border-slate-200" />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {activeTab === "recipients" ? (
        <CampaignRecipientsPanel
          campaignId={campaign.id}
          isDraft={isDraft}
          members={data.members}
          eligibleContacts={data.eligibleContacts}
        />
      ) : null}

      {activeTab === "sequence" ? (
        <CampaignSequencePanel
          campaignId={campaign.id}
          campaignStatus={campaign.status}
          automationEnabled={campaign.automation_enabled}
          campaignTimezone={campaign.timezone}
          steps={data.steps}
          members={data.members}
        />
      ) : null}

      {activeTab === "activity" ? (
        <Card>
          <CardHeader>
            <CardTitle>Campaign activity</CardTitle>
            <CardDescription>Actions recorded for this campaign.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              {data.activity.length ? data.activity.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-indigo-500" />
                  <div>
                    <p className="font-medium text-slate-900">
                      {item.eventType.replaceAll("_", " ")}
                    </p>
                    <p className="text-sm text-slate-500">
                      {new Date(item.createdAt).toLocaleString()}
                    </p>
                    {Object.keys(item.metadata).length ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {Object.entries(item.metadata).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </li>
              )) : <p className="text-sm text-slate-500">No activity recorded yet.</p>}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "analytics" ? (
        <div className="space-y-6">
          <Alert variant="warning">
            These are verified queue and provider events only. Gmail acceptance is not proof
            of inbox delivery, and opens/clicks remain zero unless a provider reports them.
          </Alert>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Accepted" value={stats.sent} />
            <Metric label="Failed / bounced" value={stats.failed} />
            <Metric label="Skipped" value={stats.skipped} />
            <Metric label="Replies recorded" value={data.replies} />
            <Metric label="Provider delivered" value={data.engagement.delivered} />
            <Metric label="Provider opens" value={data.engagement.opened} />
            <Metric label="Provider clicks" value={data.engagement.clicked} />
            <Metric label="Complaints" value={data.engagement.complained} />
          </div>
          {data.failures.length ? (
            <Card>
              <CardHeader><CardTitle>Recent delivery issues</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {data.failures.map((failure) => (
                    <li key={`${failure.email}-${failure.error}`} className="rounded-lg bg-rose-50 p-3 text-sm">
                      <p className="font-medium">{failure.email}</p>
                      <p className="text-rose-700">{failure.error}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeTab === "settings" ? (
        <Card>
          <CardHeader>
            <CardTitle>Campaign settings</CardTitle>
            <CardDescription>
              {isDraft ? "Edit internal name, sender, subject, and initial message." : "Settings are locked after launch."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isDraft ? <CampaignForm campaign={campaign} emailAccounts={accounts} /> : (
              <dl className="space-y-3 text-sm">
                <Setting label="Internal name" value={campaign.name} />
                <Setting label="Subject" value={subjectForDisplay(campaign.subject)} />
                <Setting label="Timezone" value={campaign.timezone} />
                <Setting label="Sender" value={senderLabel ?? "Not connected"} />
              </dl>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">{label}</p>
          <BarChart3 className="h-4 w-4 text-slate-400" />
        </div>
        <p className="mt-2 text-2xl font-semibold text-slate-900">{formatNumber(value)}</p>
      </CardContent>
    </Card>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}
