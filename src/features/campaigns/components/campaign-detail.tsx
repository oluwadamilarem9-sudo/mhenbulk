"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pause, Play, Send, Trash2, XCircle } from "lucide-react";

import {
  cancelCampaignAction,
  deleteCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  sendTestEmailAction,
  startCampaignAction,
} from "@/features/campaigns/actions";
import { processQueueBatchAction } from "@/features/campaigns/queue-actions";
import type {
  CampaignRow,
  CampaignStats,
  DeliveryFailure,
  EngagementStats,
} from "@/features/campaigns/queries";
import type { CampaignActionState } from "@/features/campaigns/schemas";
import { CampaignStatusBadge } from "@/features/campaigns/components/campaign-status-badge";
import { Alert } from "@/components/ui/alert";
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
import { formatNumber } from "@/lib/utils";

const POLL_INTERVAL_MS = 4000;
const initialTestState: CampaignActionState = {};

type EligibleContact = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
};

type CampaignDetailProps = {
  campaign: CampaignRow;
  stats: CampaignStats;
  eligibleContacts: EligibleContact[];
  previewHtml: string;
  failures: DeliveryFailure[];
  engagement: EngagementStats;
  senderLabel?: string | null;
};

export function CampaignDetail({
  campaign,
  stats,
  eligibleContacts,
  previewHtml,
  failures,
  engagement,
  senderLabel,
}: CampaignDetailProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(
    null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(eligibleContacts.map((contact) => contact.id)),
  );
  const [busy, startTransition] = useTransition();
  const [testState, testAction, testPending] = useActionState(
    sendTestEmailAction,
    initialTestState,
  );
  const processingRef = useRef(false);

  const isDraft = campaign.status === "draft";
  const isSending = campaign.status === "sending";
  const isPaused = campaign.status === "paused";
  const canCancel = isSending || isPaused;

  const allSelected = selectedIds.size === eligibleContacts.length;

  const progress = useMemo(() => {
    if (stats.total === 0) return 0;
    return Math.round(((stats.sent + stats.failed + stats.skipped) / stats.total) * 100);
  }, [stats]);

  const pauseMessage = useMemo(() => {
    if (!isPaused) return null;
    if (campaign.pause_reason === "auth_required") {
      return "Your Gmail connection needs to be reauthorized.";
    }
    if (campaign.pause_reason === "rate_limit") {
      return "Gmail sending quota was reached. The campaign has been paused.";
    }
    return "Sending is paused. Resume to continue processing the queue.";
  }, [campaign.pause_reason, isPaused]);

  const runQueueBatch = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      const result = await processQueueBatchAction(campaign.id);
      if (result.error) {
        setMessage({ kind: "error", text: result.error });
      }
      router.refresh();
    } finally {
      processingRef.current = false;
    }
  }, [campaign.id, router]);

  useEffect(() => {
    if (!isSending) return;

    void runQueueBatch();
    const interval = setInterval(() => {
      void runQueueBatch();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isSending, runQueueBatch]);

  function toggleContact(contactId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  }

  function handleStart() {
    if (selectedIds.size === 0) {
      setMessage({ kind: "error", text: "Select at least one contact." });
      return;
    }

    if (
      !window.confirm(
        `Start sending this campaign to ${selectedIds.size} contact(s)? Each recipient gets an individual email through your connected Gmail account.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await startCampaignAction(
        campaign.id,
        allSelected ? "all" : Array.from(selectedIds),
      );
      setMessage(
        result.error
          ? { kind: "error", text: result.error }
          : { kind: "success", text: result.success ?? "Campaign started." },
      );
      router.refresh();
    });
  }

  function handlePauseResume() {
    startTransition(async () => {
      const result = isSending
        ? await pauseCampaignAction(campaign.id)
        : await resumeCampaignAction(campaign.id);
      setMessage(
        result.error
          ? { kind: "error", text: result.error }
          : { kind: "success", text: result.success ?? "Done." },
      );
      router.refresh();
    });
  }

  function handleCancel() {
    if (
      !window.confirm(
        "Cancel this campaign? Remaining queued emails will be skipped. Messages already accepted by Gmail cannot be recalled.",
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await cancelCampaignAction(campaign.id);
      setMessage(
        result.error
          ? { kind: "error", text: result.error }
          : { kind: "success", text: result.success ?? "Campaign cancelled." },
      );
      router.refresh();
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete campaign "${campaign.name}"? This cannot be undone.`)) {
      return;
    }

    startTransition(async () => {
      const result = await deleteCampaignAction(campaign.id);
      if (result.error) {
        setMessage({ kind: "error", text: result.error });
      } else {
        router.push("/campaigns");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {campaign.name}
            </h1>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">Subject: {campaign.subject}</p>
          {senderLabel ? (
            <p className="mt-1 text-sm text-slate-500">
              Sending as: <span className="font-medium text-slate-800">{senderLabel}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-amber-700">
              No sending account selected.{" "}
              <Link href="/settings/email-accounts" className="underline">
                Connect Gmail
              </Link>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {canCancel ? (
            <Button variant="secondary" onClick={handleCancel} disabled={busy}>
              <XCircle className="h-4 w-4" />
              Cancel
            </Button>
          ) : null}
          {isSending || isPaused ? (
            <Button variant="secondary" onClick={handlePauseResume} disabled={busy}>
              {isSending ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isSending ? "Pause" : "Resume"}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="text-rose-600 hover:bg-rose-50"
            onClick={handleDelete}
            disabled={busy || isSending}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      {message ? (
        <Alert variant={message.kind === "error" ? "error" : "success"}>{message.text}</Alert>
      ) : null}
      {testState.error ? <Alert variant="error">{testState.error}</Alert> : null}
      {testState.success ? <Alert variant="success">{testState.success}</Alert> : null}
      {pauseMessage ? <Alert variant="warning">{pauseMessage}</Alert> : null}
      {campaign.pause_reason === "auth_required" ? (
        <Alert variant="warning">
          <Link href="/settings/email-accounts" className="font-medium underline">
            Reconnect Gmail
          </Link>{" "}
          then resume this campaign.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Send test email</CardTitle>
          <CardDescription>
            Sends through your connected Gmail account to a destination you choose.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={testAction}
            className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          >
            <input type="hidden" name="campaignId" value={campaign.id} />
            <div className="space-y-2">
              <Label htmlFor="test-to">Recipient</Label>
              <Input
                id="test-to"
                name="to"
                type="email"
                placeholder="test@example.com"
                required
              />
              {testState.fieldErrors?.to?.[0] ? (
                <p className="text-xs text-rose-600">{testState.fieldErrors.to[0]}</p>
              ) : null}
            </div>
            <Button type="submit" variant="secondary" disabled={testPending || busy}>
              <Send className="h-4 w-4" />
              {testPending ? "Sending..." : "Send Test Email"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {!isDraft ? (
        <Card>
          <CardHeader>
            <CardTitle>Delivery progress</CardTitle>
            <CardDescription>
              {isSending
                ? "Emails are being sent gradually as individual Gmail messages. The background worker continues after you close this page when deployed."
                : isPaused
                  ? pauseMessage
                  : campaign.status === "cancelled"
                    ? "This campaign was cancelled."
                    : "Final delivery outcome for this campaign. Sent means Gmail accepted the message — not necessarily delivered to the inbox."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <div>
                <p className="text-xs text-slate-500">Recipients</p>
                <p className="text-lg font-semibold text-slate-900">
                  {formatNumber(stats.total)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Sent</p>
                <p className="text-lg font-semibold text-emerald-600">
                  {formatNumber(stats.sent)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Failed</p>
                <p className="text-lg font-semibold text-rose-600">
                  {formatNumber(stats.failed)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Skipped</p>
                <p className="text-lg font-semibold text-slate-600">
                  {formatNumber(stats.skipped)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Pending</p>
                <p className="text-lg font-semibold text-indigo-600">
                  {formatNumber(stats.pending)}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-500">Progress {progress}%</p>
          </CardContent>
        </Card>
      ) : null}

      {!isDraft &&
      (engagement.delivered > 0 ||
        engagement.opened > 0 ||
        engagement.clicked > 0 ||
        engagement.bounced > 0 ||
        engagement.complained > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle>Engagement</CardTitle>
            <CardDescription>
              Provider-reported events when available. Gmail API acceptance alone does
              not create delivered/open/click events.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <div>
                <p className="text-xs text-slate-500">Delivered</p>
                <p className="text-lg font-semibold text-emerald-600">
                  {formatNumber(engagement.delivered)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Opened</p>
                <p className="text-lg font-semibold text-indigo-600">
                  {formatNumber(engagement.opened)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Clicked</p>
                <p className="text-lg font-semibold text-violet-600">
                  {formatNumber(engagement.clicked)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Bounced</p>
                <p className="text-lg font-semibold text-rose-600">
                  {formatNumber(engagement.bounced)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Complaints</p>
                <p className="text-lg font-semibold text-amber-600">
                  {formatNumber(engagement.complained)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {failures.length > 0 ? (
        <Card className="border-rose-200">
          <CardHeader>
            <CardTitle>Delivery issues</CardTitle>
            <CardDescription>
              The most recent failures while sending this campaign.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {failures.map((failure) => (
                <li
                  key={`${failure.email}-${failure.error}`}
                  className="rounded-lg bg-rose-50 px-3 py-2"
                >
                  <p className="font-medium text-slate-900">{failure.email}</p>
                  <p className="mt-0.5 break-words text-xs text-rose-700">
                    {failure.error}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Email preview</CardTitle>
            <CardDescription>
              Rendered with sample personalization and the unsubscribe footer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <iframe
              title="Email preview"
              srcDoc={previewHtml}
              sandbox=""
              className="h-[420px] w-full rounded-xl border border-slate-200 bg-white"
            />
          </CardContent>
        </Card>

        {isDraft ? (
          <Card>
            <CardHeader>
              <CardTitle>Recipients</CardTitle>
              <CardDescription>
                {eligibleContacts.length === 0
                  ? "No subscribed contacts available. Add contacts first."
                  : `Choose who receives this campaign (${selectedIds.size} of ${eligibleContacts.length} selected). Unsubscribed and suppressed contacts are always excluded.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {eligibleContacts.length > 0 ? (
                <>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() =>
                          setSelectedIds(
                            allSelected
                              ? new Set()
                              : new Set(eligibleContacts.map((contact) => contact.id)),
                          )
                        }
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      Select all
                    </label>
                    <Button onClick={handleStart} disabled={busy || selectedIds.size === 0}>
                      <Send className="h-4 w-4" />
                      {busy ? "Starting..." : `Send to ${selectedIds.size} contact(s)`}
                    </Button>
                  </div>

                  <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-xl border border-slate-100 p-2">
                    {eligibleContacts.map((contact) => (
                      <label
                        key={contact.id}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(contact.id)}
                          onChange={() => toggleContact(contact.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-medium text-slate-900">
                          {contact.first_name} {contact.last_name}
                        </span>
                        <span className="truncate text-slate-500">{contact.email}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Campaign timeline</CardTitle>
              <CardDescription>Key timestamps for this campaign.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <TimelineRow label="Created" value={campaign.created_at} />
                <TimelineRow label="Started" value={campaign.started_at} />
                <TimelineRow label="Paused" value={campaign.paused_at} />
                <TimelineRow label="Completed" value={campaign.completed_at} />
              </dl>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function TimelineRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">
        {value ? new Date(value).toLocaleString() : "—"}
      </dd>
    </div>
  );
}
