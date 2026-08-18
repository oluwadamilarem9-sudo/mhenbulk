"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  CalendarClock,
  Download,
  Pause,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { processQueueBatchAction } from "@/features/campaigns/queue-actions";
import {
  queueCampaignBatchAction,
  removeContactFromBatchAction,
  setCampaignBatchPausedAction,
} from "@/features/smart-batching/actions";
import type {
  SmartBatchCampaign,
  SmartBatchDetail,
} from "@/features/smart-batching/queries";

type Props = {
  detail: SmartBatchDetail;
};

function csvCell(value: string | null) {
  const text = value ?? "";
  return `"${text.replaceAll('"', '""')}"`;
}

export function BatchDetail({ detail }: Props) {
  const router = useRouter();
  const processingRef = useRef(false);
  const [search, setSearch] = useState("");
  const [scheduleFor, setScheduleFor] = useState<SmartBatchCampaign | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return detail.contacts.filter((contact) =>
      `${contact.firstName} ${contact.lastName} ${contact.email} ${
        contact.company ?? ""
      }`
        .toLowerCase()
        .includes(query),
    );
  }, [detail.contacts, search]);
  const activeCampaignIds = useMemo(
    () =>
      detail.batch.campaigns
        .filter((campaign) =>
          ["processing", "scheduled"].includes(campaign.status),
        )
        .map((campaign) => campaign.campaignId),
    [detail.batch.campaigns],
  );

  function run(action: () => Promise<{ error?: string; success?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage({
        kind: result.error ? "error" : "success",
        text: result.error ?? result.success ?? "Saved.",
      });
      if (!result.error) router.refresh();
    });
  }

  useEffect(() => {
    if (activeCampaignIds.length === 0) return;

    let cancelled = false;

    async function pumpQueue() {
      if (processingRef.current || cancelled) return;
      processingRef.current = true;
      try {
        let shouldRefresh = false;
        for (const campaignId of activeCampaignIds) {
          const result = await processQueueBatchAction(campaignId);
          if (result.error) {
            setMessage({ kind: "error", text: result.error });
          }
          if ((result.processed ?? 0) > 0 || (result.remaining ?? 0) >= 0) {
            shouldRefresh = true;
          }
        }
        if (!cancelled && shouldRefresh) router.refresh();
      } finally {
        processingRef.current = false;
      }
    }

    void pumpQueue();
    const interval = window.setInterval(() => void pumpQueue(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeCampaignIds, router]);

  function exportCsv() {
    const lines = [
      "first_name,last_name,email,company,status",
      ...detail.contacts.map((contact) =>
        [
          csvCell(contact.firstName),
          csvCell(contact.lastName),
          csvCell(contact.email),
          csvCell(contact.company),
          csvCell(contact.status),
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${detail.batch.name.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/contacts"
          className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Contacts
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {detail.batch.name}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {detail.counts.total} contacts · batch size {detail.batch.batch_size}
            </p>
          </div>
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {message ? (
        <Alert variant={message.kind === "error" ? "error" : "success"}>
          {message.text}
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Total", detail.counts.total],
          ["Active", detail.counts.active],
          ["Unsubscribed", detail.counts.unsubscribed],
          ["Bounced", detail.counts.bounced],
          ["Invalid", detail.counts.invalid],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
          </Card>
        ))}
      </div>

      {detail.batch.campaigns.length > 0 ? (
        <Card className="p-4">
          <h2 className="font-semibold text-slate-900">Campaign sending</h2>
          <p className="mt-1 text-xs text-slate-500">
            Sends use the existing controlled Gmail queue. Batching does not reset
            or bypass provider limits.
          </p>
          <div className="mt-3 space-y-2">
            {detail.batch.campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2"
              >
                <div className="mr-auto min-w-0">
                  <Link
                    href={`/campaigns/${campaign.campaignId}`}
                    className="text-sm font-medium text-slate-900 hover:text-indigo-700"
                  >
                    {campaign.campaignName}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {campaign.scheduledAt
                      ? `${new Date(campaign.scheduledAt).toLocaleString()} · ${
                          campaign.timezone
                        }`
                      : "Not scheduled"}
                  </p>
                  {campaign.providerError ? (
                    <p className="mt-1 text-xs text-rose-600">
                      {campaign.providerError}
                    </p>
                  ) : null}
                </div>
                <Badge
                  variant={
                    campaign.status === "completed"
                      ? "success"
                      : campaign.status === "failed"
                        ? "danger"
                        : campaign.status === "ready"
                          ? "info"
                          : "warning"
                  }
                >
                  {campaign.status}
                </Badge>
                {campaign.progress.total > 0 ? (
                  <div className="w-full border-t border-slate-100 pt-2 sm:order-last">
                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                      <span>
                        Sent {campaign.progress.sent} · Pending{" "}
                        {campaign.progress.pending} · Failed{" "}
                        {campaign.progress.failed}
                      </span>
                      <span>{campaign.progress.percent}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-indigo-600 transition-all"
                        style={{ width: `${campaign.progress.percent}%` }}
                      />
                    </div>
                  </div>
                ) : null}
                {campaign.status === "ready" ? (
                  <>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          queueCampaignBatchAction({
                            campaignId: campaign.campaignId,
                            batchId: detail.batch.id,
                            timezone,
                          }),
                        )
                      }
                    >
                      <Play className="h-4 w-4" />
                      Send batch
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => setScheduleFor(campaign)}
                    >
                      <CalendarClock className="h-4 w-4" />
                      Schedule
                    </Button>
                  </>
                ) : null}
                {["processing", "scheduled"].includes(campaign.status) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      run(() => setCampaignBatchPausedAction(campaign.id, true))
                    }
                  >
                    <Pause className="h-4 w-4" />
                    Pause
                  </Button>
                ) : null}
                {campaign.status === "paused" ? (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(() => setCampaignBatchPausedAction(campaign.id, false))
                    }
                  >
                    <Play className="h-4 w-4" />
                    Resume
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Alert variant="info">
          Add this batch to a draft campaign from the Contacts page before
          sending or scheduling it.
        </Alert>
      )}

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search this batch"
          className="pl-9"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => (
                <tr key={contact.membershipId} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-500">{contact.position}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
                      "—"}
                    {contact.company ? (
                      <p className="text-xs font-normal text-slate-500">
                        {contact.company}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{contact.email}</td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={contact.status === "active" ? "success" : "warning"}
                    >
                      {contact.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 hover:bg-rose-50"
                      disabled={pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Remove this contact from the batch? The contact will remain in Contacts.",
                          )
                        ) {
                          run(() =>
                            removeContactFromBatchAction(
                              detail.batch.id,
                              contact.membershipId,
                            ),
                          );
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    No contacts match this search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {scheduleFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900">
              Schedule Batch
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {detail.batch.name} · {scheduleFor.campaignName}
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Date and time
              <Input
                className="mt-1"
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-slate-700">
              Timezone
              <Input
                className="mt-1"
                value={timezone}
                readOnly
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Times use your browser&apos;s detected timezone.
              </span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setScheduleFor(null)}>
                Cancel
              </Button>
              <Button
                disabled={pending || !scheduledAt}
                onClick={() => {
                  const iso = new Date(scheduledAt).toISOString();
                  run(() =>
                    queueCampaignBatchAction({
                      campaignId: scheduleFor.campaignId,
                      batchId: detail.batch.id,
                      scheduledAt: iso,
                      timezone,
                    }),
                  );
                  setScheduleFor(null);
                }}
              >
                Schedule batch
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
