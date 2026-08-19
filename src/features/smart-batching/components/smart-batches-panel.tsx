"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  Boxes,
  Copy,
  ExternalLink,
  Pencil,
  Plus,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  addBatchesToCampaignAction,
  copyContactBatchEmailsAction,
  deleteContactBatchAction,
  deleteContactBatchesAction,
  renameContactBatchAction,
  saveDefaultBatchSizeAction,
} from "@/features/smart-batching/actions";
import type {
  BatchCampaignOption,
  SmartBatchSummary,
} from "@/features/smart-batching/queries";

type Props = {
  batches: SmartBatchSummary[];
  defaultBatchSize: number;
  campaigns: BatchCampaignOption[];
};

const statusVariant = {
  draft: "muted",
  ready: "info",
  scheduled: "warning",
  processing: "info",
  completed: "success",
  paused: "warning",
  cancelled: "muted",
  failed: "danger",
} as const;

export function SmartBatchesPanel({
  batches,
  defaultBatchSize,
  campaigns,
}: Props) {
  const router = useRouter();
  const [sizeChoice, setSizeChoice] = useState(
    [25, 50, 100].includes(defaultBatchSize)
      ? String(defaultBatchSize)
      : "custom",
  );
  const [customSize, setCustomSize] = useState(
    [25, 50, 100].includes(defaultBatchSize) ? 75 : defaultBatchSize,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [batchSearch, setBatchSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(60);

  const batchSize =
    sizeChoice === "custom" ? customSize : Number(sizeChoice);
  const totalContacts = batches.reduce(
    (total, batch) => total + batch.total_contacts,
    0,
  );

  const filteredBatches = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter((b) => b.name.toLowerCase().includes(q));
  }, [batches, batchSearch]);

  const visibleBatches = filteredBatches.slice(0, visibleCount);

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

  function copySelectedEmails() {
    setMessage(null);
    startTransition(async () => {
      const result = await copyContactBatchEmailsAction([...selected]);
      if (result.error || !result.text) {
        setMessage({
          kind: "error",
          text: result.error ?? "Unable to copy emails.",
        });
        return;
      }
      try {
        await navigator.clipboard.writeText(result.text);
        setMessage({
          kind: "success",
          text: `Copied ${result.count ?? 0} email${
            result.count === 1 ? "" : "s"
          } to your clipboard.`,
        });
      } catch {
        setMessage({
          kind: "error",
          text: "Your browser blocked clipboard access. Try again or copy from batch export.",
        });
      }
    });
  }

  return (
    <section id="smart-batches" className="scroll-mt-24 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            {batches.length > 0 ? (
              <input
                type="checkbox"
                aria-label="Select all batches"
                checked={selected.size === batches.length && batches.length > 0}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      selected.size > 0 && selected.size < batches.length;
                  }
                }}
                onChange={() => {
                  if (selected.size === batches.length) {
                    setSelected(new Set());
                  } else {
                    setSelected(new Set(batches.map((b) => b.id)));
                  }
                }}
                className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
              />
            ) : null}
            <Boxes className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-slate-900">Smart Batches</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {batches.length} batch{batches.length === 1 ? "" : "es"} ·{" "}
            {totalContacts} grouped contact{totalContacts === 1 ? "" : "s"}
          </p>
          {batches.length > 12 && (
            <input
              type="search"
              placeholder="Search batches…"
              value={batchSearch}
              onChange={(e) => { setBatchSearch(e.target.value); setVisibleCount(60); }}
              className="mt-2 h-8 w-64 rounded-lg border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {[25, 50, 100].map((size) => (
            <label
              key={size}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            >
              <input
                type="radio"
                name="default-batch-size"
                value={size}
                checked={sizeChoice === String(size)}
                onChange={() => setSizeChoice(String(size))}
              />
              {size}
            </label>
          ))}
          <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm">
            <input
              type="radio"
              name="default-batch-size"
              checked={sizeChoice === "custom"}
              onChange={() => setSizeChoice("custom")}
            />
            Custom
            {sizeChoice === "custom" ? (
              <Input
                type="number"
                min={1}
                max={1000}
                value={customSize}
                onChange={(event) => setCustomSize(Number(event.target.value))}
                className="h-7 w-20"
                aria-label="Custom default batch size"
              />
            ) : null}
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || batchSize < 1 || batchSize > 1000}
            onClick={() => run(() => saveDefaultBatchSizeAction(batchSize))}
          >
            <Save className="h-4 w-4" />
            Save default
          </Button>
        </div>
      </div>

      {message ? (
        <Alert variant={message.kind === "error" ? "error" : "success"}>
          {message.text}
        </Alert>
      ) : null}

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <p className="mr-auto text-sm font-medium text-indigo-900">
            {selected.size} batch{selected.size === 1 ? "" : "es"} selected
          </p>
          <select
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
            className="h-9 rounded-lg border border-indigo-200 bg-white px-3 text-sm"
            aria-label="Choose draft campaign"
          >
            <option value="">Choose draft campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" disabled={pending} onClick={copySelectedEmails}>
            <Copy className="h-4 w-4" />
            Copy emails
          </Button>
          <Button
            size="sm"
            disabled={pending || !campaignId}
            onClick={() =>
              run(async () => {
                const result = await addBatchesToCampaignAction(campaignId, [
                  ...selected,
                ]);
                if (!result.error) setSelected(new Set());
                return result;
              })
            }
          >
            <Plus className="h-4 w-4" />
            Add to campaign
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-rose-600 hover:bg-rose-50"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${selected.size} batch${selected.size === 1 ? "" : "es"}? The contacts will remain in Contacts.`,
                )
              ) {
                run(async () => {
                  const result = await deleteContactBatchesAction([...selected]);
                  if (!result.error) setSelected(new Set());
                  return result;
                });
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete selected
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      ) : null}

      {batches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <span className="mb-3 rounded-full bg-indigo-50 p-3 text-indigo-600">
              <Boxes className="h-6 w-6" />
            </span>
            <p className="font-semibold text-slate-900">No batches yet</p>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Import contacts or select contacts below to organize them into
              manageable groups.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
        {batchSearch && filteredBatches.length === 0 && (
          <p className="text-sm text-slate-500 px-1">
            No batches match &quot;{batchSearch}&quot;.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleBatches.map((batch) => {
            const activeCampaign = batch.campaigns[0];
            const displayStatus = activeCampaign?.status ?? batch.status;
            return (
              <Card key={batch.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(batch.id)}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(batch.id)) next.delete(batch.id);
                            else next.add(batch.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${batch.name}`}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600"
                      />
                      <div className="min-w-0">
                        <CardTitle className="truncate">{batch.name}</CardTitle>
                        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                          <Users className="h-3.5 w-3.5" />
                          {batch.total_contacts} contacts · size {batch.batch_size}
                        </p>
                      </div>
                    </div>
                    <Badge variant={statusVariant[displayStatus]}>
                      {displayStatus}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-2">
                  {activeCampaign ? (
                    <p className="truncate text-xs text-slate-500">
                      Campaign: {activeCampaign.campaignName}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Created from {batch.source.replaceAll("_", " ")}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    <Link
                      href={`/batches/${batch.id}`}
                      className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        const name = window.prompt("Rename batch", batch.name);
                        if (name?.trim()) {
                          run(() => renameContactBatchAction(batch.id, name));
                        }
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 hover:bg-rose-50"
                      disabled={pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Delete this batch grouping? The underlying contacts will remain in Contacts.",
                          )
                        ) {
                          run(() => deleteContactBatchAction(batch.id));
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {visibleCount < filteredBatches.length && (
          <button
            onClick={() => setVisibleCount((n) => n + 60)}
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Load more ({filteredBatches.length - visibleCount} remaining)
          </button>
        )}
        </div>
      )}
    </section>
  );
}
