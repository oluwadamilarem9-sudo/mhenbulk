"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, LoaderCircle, Sparkles, Upload } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addCleanerResultsToCampaignAction,
  addCleanerResultsToContactsAction,
  addCleanerResultsToSmartBatchesAction,
  cancelEmailCleaningJobAction,
  createEmailCleaningJobFromCsvAction,
  createEmailCleaningJobFromPasteAction,
  exportEmailCleaningCsvAction,
  processEmailCleaningJobAction,
  setCleanerResultSelectionAction,
  setCleanerReviewDecisionAction,
} from "@/features/email-cleaner/actions";
import type { EmailCleanerJob, EmailCleanerResult } from "@/features/email-cleaner/queries";

type DraftCampaign = { id: string; name: string; status: string };

type Props = {
  jobs: EmailCleanerJob[];
  activeJob: EmailCleanerJob | null;
  results: EmailCleanerResult[];
  draftCampaigns: DraftCampaign[];
};

const FILTERS = [
  "ALL",
  "VALID",
  "CORRECTED",
  "DUPLICATE",
  "INVALID",
  "SUSPICIOUS",
  "REVIEW_REQUIRED",
] as const;

export function EmailCleanerPanel({ jobs, activeJob, results, draftCampaigns }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pasteText, setPasteText] = useState("");
  const [keepMode, setKeepMode] = useState<"first" | "last">("first");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [search, setSearch] = useState("");
  const [campaignId, setCampaignId] = useState(draftCampaigns[0]?.id ?? "");
  const [batchSize, setBatchSize] = useState(50);
  const [csvText, setCsvText] = useState("");
  const [csvEmailColumn, setCsvEmailColumn] = useState<string>("");
  const [csvColumns, setCsvColumns] = useState<string[]>([]);

  useEffect(() => {
    if (!activeJob) return;
    if (!["pending", "processing"].includes(activeJob.status)) return;
    let cancelled = false;
    const tick = async () => {
      const res = await processEmailCleaningJobAction(activeJob.id);
      if (!cancelled && res.error) {
        setMessage({ kind: "error", text: res.error });
      }
      if (!cancelled) router.refresh();
    };
    const timer = window.setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeJob, router]);

  const filtered = useMemo(() => {
    return results.filter((row) => {
      const okStatus = statusFilter === "ALL" || row.status === statusFilter;
      const q = search.trim().toLowerCase();
      const okSearch =
        !q ||
        row.originalEmail.toLowerCase().includes(q) ||
        (row.cleanEmail ?? "").toLowerCase().includes(q) ||
        row.issue.toLowerCase().includes(q);
      return okStatus && okSearch;
    });
  }, [results, search, statusFilter]);

  const selectedIds = useMemo(
    () => filtered.filter((row) => row.selected).map((row) => row.id),
    [filtered],
  );

  const progressPercent = activeJob?.total
    ? Math.min(100, Math.round((activeJob.processed / activeJob.total) * 100))
    : 0;

  function openJob(jobId: string) {
    router.push(`/email-cleaner?jobId=${jobId}`);
  }

  function run(action: () => Promise<{ error?: string; success?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setMessage({ kind: "error", text: result.error });
      else if (result.success) setMessage({ kind: "success", text: result.success });
      router.refresh();
    });
  }

  function startPasteJob() {
    if (!pasteText.trim()) {
      setMessage({ kind: "error", text: "Paste at least one email." });
      return;
    }
    startTransition(async () => {
      const result = await createEmailCleaningJobFromPasteAction({ text: pasteText, keepMode });
      if (result.error) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      if (result.jobId) router.push(`/email-cleaner?jobId=${result.jobId}`);
    });
  }

  function startCsvJob() {
    if (!csvText.trim()) {
      setMessage({ kind: "error", text: "Paste CSV content first or use upload." });
      return;
    }
    startTransition(async () => {
      const result = await createEmailCleaningJobFromCsvAction({
        fileText: csvText,
        emailColumn: csvEmailColumn || undefined,
        keepMode,
      });
      if (result.error) {
        setMessage({ kind: "error", text: result.error });
        if (result.needsColumnSelection) setCsvColumns(result.columns ?? []);
        return;
      }
      if (result.jobId) router.push(`/email-cleaner?jobId=${result.jobId}`);
    });
  }

  function onUploadCsv(file: File) {
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  return (
    <div className="space-y-4">
      <Alert variant="info">
        Email format validation does not guarantee deliverability.
      </Alert>
      {message ? (
        <Alert variant={message.kind === "error" ? "error" : "success"}>
          {message.text}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Paste Emails</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder="john@example.com, mary@example.com or one per line"
              rows={8}
            />
            <div className="flex items-center gap-3 text-sm">
              <Label htmlFor="keep-mode">Duplicate handling</Label>
              <select
                id="keep-mode"
                className="h-9 rounded-md border border-slate-200 bg-white px-2"
                value={keepMode}
                onChange={(event) => setKeepMode(event.target.value as "first" | "last")}
              >
                <option value="first">Keep first occurrence</option>
                <option value="last">Keep last occurrence</option>
              </select>
            </div>
            <Button onClick={startPasteJob} disabled={pending}>
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Start Cleaning
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upload CSV</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUploadCsv(file);
              }}
            />
            <Textarea
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              placeholder="Paste CSV content here (optional)."
              rows={5}
            />
            {csvColumns.length > 0 ? (
              <div className="space-y-1">
                <Label>Select email column</Label>
                <select
                  value={csvEmailColumn}
                  onChange={(event) => setCsvEmailColumn(event.target.value)}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2"
                >
                  <option value="">Choose column</option>
                  {csvColumns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <Button variant="secondary" onClick={startCsvJob} disabled={pending}>
              <Upload className="h-4 w-4" />
              Parse CSV and Clean
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {jobs.length === 0 ? (
            <p className="text-sm text-slate-500">No cleaning jobs yet.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => openJob(job.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                    activeJob?.id === job.id
                      ? "border-indigo-300 bg-indigo-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">Job {job.id.slice(0, 8)}</span>
                    <Badge variant={job.status === "completed" ? "success" : "info"}>
                      {job.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {job.processed}/{job.total} processed
                  </p>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {activeJob ? (
        <Card>
          <CardHeader>
            <CardTitle>Job Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-indigo-600 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-sm text-slate-600">
              Processed {activeJob.processed} / {activeJob.total}
            </p>
            <div className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <Badge variant="success">Valid: {activeJob.counts.valid}</Badge>
              <Badge variant="info">Corrected: {activeJob.counts.corrected}</Badge>
              <Badge variant="warning">Duplicate: {activeJob.counts.duplicate}</Badge>
              <Badge variant="danger">Invalid: {activeJob.counts.invalid}</Badge>
              <Badge variant="warning">Suspicious: {activeJob.counts.suspicious}</Badge>
              <Badge variant="muted">Review: {activeJob.counts.review}</Badge>
            </div>
            {["pending", "processing"].includes(activeJob.status) ? (
              <Button
                variant="ghost"
                onClick={() => run(() => cancelEmailCleaningJobAction(activeJob.id))}
              >
                Cancel Processing
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {activeJob ? (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((filter) => (
                <Button
                  key={filter}
                  size="sm"
                  variant={statusFilter === filter ? "secondary" : "ghost"}
                  onClick={() => setStatusFilter(filter)}
                >
                  {filter}
                </Button>
              ))}
              <Input
                className="h-9 w-64"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search emails..."
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  run(() =>
                    setCleanerResultSelectionAction(
                      activeJob.id,
                      filtered.map((r) => r.id),
                      true,
                    ),
                  )
                }
              >
                Select All Filtered
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  run(() =>
                    setCleanerResultSelectionAction(
                      activeJob.id,
                      filtered.map((r) => r.id),
                      false,
                    ),
                  )
                }
              >
                Deselect All Filtered
              </Button>
              <Button
                size="sm"
                onClick={() => run(() => addCleanerResultsToContactsAction(activeJob.id))}
              >
                Add to Contacts
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!campaignId}
                onClick={() =>
                  run(() => addCleanerResultsToCampaignAction(activeJob.id, campaignId))
                }
              >
                Add to Campaign
              </Button>
              <select
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
              >
                <option value="">Choose campaign</option>
                {draftCampaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                className="h-8 w-24"
                min={1}
                max={1000}
                value={batchSize}
                onChange={(event) => setBatchSize(Number(event.target.value))}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  run(() => addCleanerResultsToSmartBatchesAction(activeJob.id, batchSize))
                }
              >
                Add to Smart Batches
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  startTransition(async () => {
                    const exported = await exportEmailCleaningCsvAction(activeJob.id);
                    if (exported.error || !exported.csv) {
                      setMessage({ kind: "error", text: exported.error ?? "Unable to export CSV." });
                      return;
                    }
                    const blob = new Blob([exported.csv], { type: "text/csv;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `email-cleaner-${activeJob.id.slice(0, 8)}.csv`;
                    link.click();
                    URL.revokeObjectURL(url);
                  })
                }
              >
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Select</th>
                    <th className="px-3 py-2">Original Email</th>
                    <th className="px-3 py-2">Clean Email</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Issue</th>
                    <th className="px-3 py-2">Suggested Correction</th>
                    <th className="px-3 py-2">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(event) =>
                            run(() =>
                              setCleanerResultSelectionAction(
                                activeJob.id,
                                [row.id],
                                event.target.checked,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{row.originalEmail}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.cleanEmail ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant={row.status === "INVALID" ? "danger" : "info"}>
                          {row.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.issue || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.suggestedCorrection ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.status === "REVIEW_REQUIRED" ? (
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => run(() => setCleanerReviewDecisionAction(row.id, "accept"))}
                            >
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                run(() => setCleanerReviewDecisionAction(row.id, "keep_original"))
                              }
                            >
                              Keep
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => run(() => setCleanerReviewDecisionAction(row.id, "reject"))}
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              {selectedIds.length} selected in current filter.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

