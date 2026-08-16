"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Copy,
  Download,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";

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
import {
  addBatchResultsToCampaignAction,
  addBatchResultsToContactsAction,
  markBatchResultsSelectedAction,
  prepareBatchCampaignContactsAction,
} from "@/features/email-finder/actions";
import {
  cancelWebsiteScanBatchAction,
  createWebsiteScanBatchAction,
  createWebsiteScanBatchFromTextAction,
  deleteWebsiteScanBatchAction,
  pauseWebsiteScanBatchAction,
  resumeWebsiteScanBatchAction,
  retryFailedWebsitesAction,
} from "@/features/email-finder/batch-actions";
import type {
  EmailFinderBatchDetail,
  EmailFinderBatchProgress,
  EmailFinderBatchSummary,
} from "@/features/email-finder/batch-queries";
import { exportResultsCsv } from "@/features/email-finder/export-csv";
import { FinderResultsTable } from "@/features/email-finder/components/finder-results-table";
import type { EmailFinderActionState } from "@/features/email-finder/schemas";
import { isOwnerGradeEmail } from "@/features/email-finder/score";
import {
  MAX_BATCH_TARGETS,
  parseWebsiteUrlFile,
  type ParsedWebsiteFile,
} from "@/features/email-finder/url-file";

type DraftCampaign = {
  id: string;
  name: string;
  status: string;
};

type Props = {
  batches: EmailFinderBatchSummary[];
  detail: EmailFinderBatchDetail | null;
  draftCampaigns: DraftCampaign[];
};

const ACTIVE_STATUSES = new Set(["pending", "running"]);

function statusLabel(status: EmailFinderBatchSummary["status"]): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "running":
      return "Scanning";
    case "paused":
      return "Paused";
    case "cancelled":
      return "Stopped";
    default:
      return "Completed";
  }
}

export function WebsiteBatchPanel({ batches, detail, draftCampaigns }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const drivingRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [customPathDraft, setCustomPathDraft] = useState("");
  const [customPaths, setCustomPaths] = useState<string[]>([]);
  const [ownerGradeOnly, setOwnerGradeOnly] = useState(false);
  const [deepCrawl, setDeepCrawl] = useState(true);
  const [preview, setPreview] = useState<ParsedWebsiteFile | null>(null);
  const [message, setMessage] = useState<EmailFinderActionState | null>(null);
  const [live, setLive] = useState<{
    batchId: string;
    progress: EmailFinderBatchProgress;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "personal" | "business" | "generic"
  >("all");
  const [confidenceFilter, setConfidenceFilter] = useState<
    "all" | "high" | "medium" | "low"
  >("all");
  const [ownerGradeFilter, setOwnerGradeFilter] = useState(false);
  const [selectionOverride, setSelectionOverride] = useState<{
    batchId: string | null;
    ids: Set<string>;
  } | null>(null);
  const [campaignId, setCampaignId] = useState(draftCampaigns[0]?.id ?? "");
  const [showCampaignPicker, setShowCampaignPicker] = useState(false);
  const [busy, startTransition] = useTransition();

  const batchId = detail?.batch.id ?? null;
  const results = useMemo(() => detail?.results ?? [], [detail]);

  // Live worker updates win, otherwise the server snapshot is the truth.
  const progress =
    live && live.batchId === batchId ? live.progress : (detail?.batch ?? null);

  const savedSelection = useMemo(
    () => new Set(results.filter((row) => row.selected).map((row) => row.id)),
    [results],
  );
  const selected =
    selectionOverride && selectionOverride.batchId === batchId
      ? selectionOverride.ids
      : savedSelection;

  const readProgress = useCallback(async (id: string) => {
    const response = await fetch(`/api/email-finder/batches/${id}/run`);
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      progress?: EmailFinderBatchProgress | null;
    };
    return payload.progress ?? null;
  }, []);

  /**
   * Keeps the open batch moving while the page is visible. The cron worker does
   * the same job in the background, and target claims stop the two from
   * scanning the same website twice.
   */
  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;

    async function drive(id: string) {
      try {
        for (;;) {
          const snapshot = await readProgress(id);
          if (cancelled) return;
          if (!snapshot) {
            setRunning(false);
            return;
          }

          setLive({ batchId: id, progress: snapshot });
          const remaining = snapshot.queuedTargets + snapshot.runningTargets;
          if (!ACTIVE_STATUSES.has(snapshot.status) || remaining === 0) {
            setRunning(false);
            return;
          }

          if (drivingRef.current) return;
          drivingRef.current = true;
          setRunning(true);

          try {
            const response = await fetch(`/api/email-finder/batches/${id}/run`, {
              method: "POST",
            });
            if (!response.ok) {
              setRunning(false);
              return;
            }
            const payload = (await response.json()) as {
              idle?: boolean;
              progress?: EmailFinderBatchProgress | null;
            };
            if (cancelled) return;
            if (payload.progress) {
              setLive({ batchId: id, progress: payload.progress });
            }
            router.refresh();
            if (payload.idle) {
              setRunning(false);
              return;
            }
          } finally {
            drivingRef.current = false;
          }
        }
      } catch {
        // Network hiccups are fine: the cron worker keeps the batch moving.
        if (!cancelled) setRunning(false);
      }
    }

    void drive(batchId);
    return () => {
      cancelled = true;
    };
  }, [batchId, readProgress, router]);

  // Counters keep moving while a long run is still in flight.
  useEffect(() => {
    if (!batchId || !running) return;
    const timer = window.setInterval(async () => {
      const snapshot = await readProgress(batchId).catch(() => null);
      if (snapshot) setLive({ batchId, progress: snapshot });
    }, 5_000);

    return () => window.clearInterval(timer);
  }, [batchId, running, readProgress]);

  const pastedStats = useMemo(() => {
    if (!pasted.trim()) {
      return { entered: 0, unique: 0, duplicates: 0 };
    }
    const parsed = parseWebsiteUrlFile(pasted, "pasted.csv");
    const entered = pasted
      .split(/[\n,]+/)
      .map((part) => part.trim())
      .filter(Boolean).length;
    return {
      entered,
      unique: parsed.rows.length,
      duplicates: parsed.duplicates,
    };
  }, [pasted]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const preferOwnerGrade = ownerGradeFilter || Boolean(progress?.ownerGradeOnly);
    return results.filter((row) => {
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      if (confidenceFilter !== "all" && row.confidence !== confidenceFilter) {
        return false;
      }
      if (preferOwnerGrade && !isOwnerGradeEmail(row.email, row.category)) {
        return false;
      }
      if (!query) return true;
      return (
        row.email.toLowerCase().includes(query) ||
        row.domain.toLowerCase().includes(query) ||
        row.sourceUrl.toLowerCase().includes(query)
      );
    });
  }, [
    results,
    search,
    categoryFilter,
    confidenceFilter,
    ownerGradeFilter,
    progress?.ownerGradeOnly,
  ]);

  async function handleFileSelected(selectedFile: File | null) {
    if (!selectedFile) return;
    setMessage(null);
    if (selectedFile.size > 2 * 1024 * 1024) {
      setFile(selectedFile);
      setPreview({
        rows: [],
        duplicates: 0,
        skipped: 0,
        truncated: false,
        error: "Website lists are limited to 2 MB.",
      });
      return;
    }
    const parsed = parseWebsiteUrlFile(
      await selectedFile.text(),
      selectedFile.name,
    );
    setFile(selectedFile);
    setPreview(parsed);
  }

  function cancelPreview() {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function openQueuedBatch(result: { error?: string; success?: string; batchId?: string }) {
    if (result.error) {
      setMessage({ error: result.error });
      return;
    }
    setMessage({ success: result.success });
    if (result.batchId) {
      router.push(`/email-finder?batchId=${result.batchId}`);
    }
    router.refresh();
  }

  function queueBatch() {
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    formData.set("customPaths", customPaths.join("\n"));
    formData.set("ownerGradeOnly", ownerGradeOnly ? "1" : "0");
    formData.set("deepCrawl", deepCrawl ? "1" : "0");

    startTransition(async () => {
      const result = await createWebsiteScanBatchAction(formData);
      if (!result.error) cancelPreview();
      openQueuedBatch(result);
    });
  }

  function queuePastedBatch() {
    const text = pasted;
    startTransition(async () => {
      const result = await createWebsiteScanBatchFromTextAction(text, {
        customPaths,
        ownerGradeOnly,
        deepCrawl,
      });
      if (!result.error) setPasted("");
      openQueuedBatch(result);
    });
  }

  function addCustomPath() {
    const path = customPathDraft.trim();
    if (!path) return;
    setCustomPaths((current) =>
      current.includes(path) ? current : [...current, path].slice(0, 20),
    );
    setCustomPathDraft("");
  }

  function runAction(action: () => Promise<{ error?: string; success?: string }>) {
    startTransition(async () => {
      const result = await action();
      setMessage(result);
      router.refresh();
    });
  }

  function updateSelection(update: (current: Set<string>) => Set<string>) {
    setSelectionOverride({ batchId, ids: update(selected) });
  }

  function toggle(id: string) {
    updateSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedRows = results.filter((row) => selected.has(row.id));
  const processed = progress
    ? Math.min(progress.processedTargets, progress.totalTargets)
    : 0;
  const percent =
    progress && progress.totalTargets > 0
      ? Math.round((processed / progress.totalTargets) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Scan a list of websites</CardTitle>
          <CardDescription>
            Upload a CSV, TSV, or TXT file of website addresses and every site is
            scanned for public emails in the background. You can close this page —
            scanning continues.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="pasted-websites">Paste website addresses</Label>
            <textarea
              id="pasted-websites"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
              rows={4}
              placeholder={"https://example.com\nexample-shop.de\nanother-site.com"}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <p className="text-xs text-slate-500">
              {pastedStats.unique > 0
                ? `${pastedStats.entered} URLs entered · ${pastedStats.unique} unique ready${
                    pastedStats.duplicates
                      ? ` · ${pastedStats.duplicates} duplicates removed`
                      : ""
                  }`
                : "One per line, or comma separated. Duplicates are removed automatically."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-paths">Custom pages to scan</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="custom-paths"
                value={customPathDraft}
                onChange={(event) => setCustomPathDraft(event.target.value)}
                placeholder="/partners"
                className="max-w-xs"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={addCustomPath}
                disabled={!customPathDraft.trim()}
              >
                Add
              </Button>
            </div>
            {customPaths.length ? (
              <div className="flex flex-wrap gap-2">
                {customPaths.map((path) => (
                  <button
                    key={path}
                    type="button"
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200"
                    onClick={() =>
                      setCustomPaths((current) =>
                        current.filter((item) => item !== path),
                      )
                    }
                  >
                    {path} ×
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Optional same-site paths such as /team or /policies/privacy-policy.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={deepCrawl}
                onChange={(event) => setDeepCrawl(event.target.checked)}
              />
              Deep crawl contact, about, team, and policy pages
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={ownerGradeOnly}
                onChange={(event) => setOwnerGradeOnly(event.target.checked)}
              />
              Owner-grade only
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={queuePastedBatch} disabled={busy || pastedStats.unique === 0}>
              <Search className="h-4 w-4" />
              Start extraction
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!pasted}
              onClick={() => setPasted("")}
            >
              Clear
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
              className="hidden"
              onChange={(event) =>
                void handleFileSelected(event.target.files?.[0] ?? null)
              }
            />
            <Button
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Upload className="h-4 w-4" />
              Import file
            </Button>
          </div>

          <p className="text-xs text-slate-500">
            A header row is optional — website addresses are detected automatically,
            so exports with columns such as <code>domain_url</code> work as-is. Each
            site&apos;s homepage plus its contact, about, and policy pages are checked.
            Up to {MAX_BATCH_TARGETS.toLocaleString()} websites per list.
          </p>
        </CardContent>
      </Card>

      {message?.error ? <Alert variant="error">{message.error}</Alert> : null}
      {message?.success ? <Alert variant="success">{message.success}</Alert> : null}

      {file && preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Preview websites
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review {file.name} before scanning.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelPreview}
                aria-label="Cancel upload"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {preview.error ? (
              <div className="mt-4">
                <Alert variant="error">{preview.error}</Alert>
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    ["Websites", preview.rows.length],
                    ["Duplicates skipped", preview.duplicates],
                    ["Rows ignored", preview.skipped],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="text-lg font-semibold text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>

                {preview.truncated ? (
                  <div className="mt-3">
                    <Alert variant="warning">
                      Only the first {MAX_BATCH_TARGETS.toLocaleString()} websites
                      will be queued from this file.
                    </Alert>
                  </div>
                ) : null}

                <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                  {preview.rows.slice(0, 10).map((row) => (
                    <li key={row.url} className="break-all px-3 py-2 text-slate-700">
                      {row.url}
                    </li>
                  ))}
                </ul>
                {preview.rows.length > 10 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Showing 10 of {preview.rows.length} websites.
                  </p>
                ) : null}
              </>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={cancelPreview} disabled={busy}>
                Cancel
              </Button>
              <Button
                onClick={queueBatch}
                disabled={busy || Boolean(preview.error) || preview.rows.length === 0}
              >
                {busy
                  ? "Queueing..."
                  : `Scan ${preview.rows.length} website${preview.rows.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {progress && batchId ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{progress.name}</CardTitle>
                <CardDescription>
                  Homepage plus contact, about, and policy pages are checked on
                  every website.
                </CardDescription>
              </div>
              <Badge
                variant={
                  progress.status === "running"
                    ? "info"
                    : progress.status === "completed"
                      ? "muted"
                      : "warning"
                }
              >
                {statusLabel(progress.status)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Scanned", `${processed}/${progress.totalTargets}`],
                ["Emails found", progress.emailsFound],
                ["No email", progress.emptyTargets],
                ["Unreachable", progress.failedTargets],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-lg font-semibold text-slate-900">{value}</p>
                </div>
              ))}
            </div>

            {ACTIVE_STATUSES.has(progress.status) ? (
              <p className="inline-flex items-center gap-2 text-sm text-slate-600">
                <LoaderCircle className="h-4 w-4 animate-spin text-indigo-600" />
                {progress.currentlyScanning.length
                  ? `Currently scanning: ${progress.currentlyScanning.join(", ")}`
                  : "Scanning in the background. Results appear here as each website finishes."}
              </p>
            ) : progress.status === "completed" ? (
              <Alert variant="success">
                Extraction complete — {progress.totalTargets} websites scanned,{" "}
                {progress.emailsFound} unique emails found
                {progress.emptyTargets
                  ? `, ${progress.emptyTargets} with no public email`
                  : ""}
                {progress.failedTargets
                  ? `, ${progress.failedTargets} unreachable`
                  : ""}
                .
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {progress.status === "paused" ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => runAction(() => resumeWebsiteScanBatchAction(batchId))}
                >
                  <Play className="h-4 w-4" />
                  Resume
                </Button>
              ) : null}
              {ACTIVE_STATUSES.has(progress.status) ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => runAction(() => pauseWebsiteScanBatchAction(batchId))}
                >
                  <Pause className="h-4 w-4" />
                  Pause
                </Button>
              ) : null}
              {progress.status !== "completed" && progress.status !== "cancelled" ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => runAction(() => cancelWebsiteScanBatchAction(batchId))}
                >
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              ) : null}
              {progress.failedTargets > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => runAction(() => retryFailedWebsitesAction(batchId))}
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry {progress.failedTargets} failed
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteWebsiteScanBatchAction(batchId);
                    setMessage(result);
                    router.push("/email-finder");
                    router.refresh();
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
                Delete list
              </Button>
            </div>

            {detail?.failures.length ? (
              <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <summary className="cursor-pointer font-medium text-slate-700">
                  {detail.failures.length} website
                  {detail.failures.length === 1 ? "" : "s"} could not be scanned
                </summary>
                <ul className="mt-2 space-y-1 text-slate-600">
                  {detail.failures.map((failure) => (
                    <li key={failure.id}>
                      {failure.domain} — {failure.errorMessage ?? "Unavailable"}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {results.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                {ACTIVE_STATUSES.has(progress.status)
                  ? "No emails yet — results appear as websites finish scanning."
                  : "No publicly visible email addresses were found on these websites."}
              </div>
            ) : (
              <>
                {detail?.truncated ? (
                  <Alert variant="info">
                    Showing the first {results.length.toLocaleString()} unique emails
                    from this list. Export to CSV to keep a full copy.
                  </Alert>
                ) : null}

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search emails or websites"
                      className="pl-9"
                    />
                  </div>
                  <select
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                    value={categoryFilter}
                    onChange={(event) =>
                      setCategoryFilter(event.target.value as typeof categoryFilter)
                    }
                  >
                    <option value="all">All types</option>
                    <option value="personal">Personal</option>
                    <option value="business">Business</option>
                    <option value="generic">Generic</option>
                  </select>
                  <select
                    className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                    value={confidenceFilter}
                    onChange={(event) =>
                      setConfidenceFilter(
                        event.target.value as typeof confidenceFilter,
                      )
                    }
                  >
                    <option value="all">All confidence</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={ownerGradeFilter || Boolean(progress.ownerGradeOnly)}
                      onChange={(event) => setOwnerGradeFilter(event.target.checked)}
                    />
                    Owner-grade only
                  </label>
                </div>

                <FinderResultsTable
                  rows={filtered}
                  selected={selected}
                  onToggle={toggle}
                  showDomain
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      updateSelection((current) => {
                        const next = new Set(current);
                        for (const row of filtered) next.add(row.id);
                        return next;
                      })
                    }
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => updateSelection(() => new Set())}
                  >
                    Deselect All
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || selectedRows.length === 0}
                    onClick={() =>
                      runAction(() =>
                        addBatchResultsToContactsAction(batchId, [...selected]),
                      )
                    }
                  >
                    <UserPlus className="h-4 w-4" />
                    Add Selected to Contacts
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || selectedRows.length === 0}
                    onClick={() => setShowCampaignPicker((value) => !value)}
                  >
                    Add Selected to Campaign
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={selectedRows.length === 0}
                    onClick={() =>
                      exportResultsCsv(selectedRows, `${progress.name}-emails.csv`)
                    }
                  >
                    <Download className="h-4 w-4" />
                    Export CSV
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={selectedRows.length === 0}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(selectedRows.map((row) => row.email).join("\n"))
                        .then(() =>
                          setMessage({
                            success: `${selectedRows.length} email${selectedRows.length === 1 ? "" : "s"} copied.`,
                          }),
                        )
                    }
                  >
                    <Copy className="h-4 w-4" />
                    Copy Selected
                  </Button>
                </div>

                {showCampaignPicker ? (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h3 className="font-semibold text-slate-900">Add to Campaign</h3>
                    {draftCampaigns.length ? (
                      <>
                        <Label htmlFor="batch-campaign">Select Campaign</Label>
                        <select
                          id="batch-campaign"
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                          value={campaignId}
                          onChange={(event) => setCampaignId(event.target.value)}
                        >
                          {draftCampaigns.map((campaign) => (
                            <option key={campaign.id} value={campaign.id}>
                              {campaign.name}
                            </option>
                          ))}
                        </select>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            disabled={busy || !campaignId || selected.size === 0}
                            onClick={() =>
                              runAction(() =>
                                addBatchResultsToCampaignAction(
                                  batchId,
                                  [...selected],
                                  campaignId,
                                ),
                              )
                            }
                          >
                            Add Contacts
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy || selected.size === 0}
                            onClick={() =>
                              startTransition(async () => {
                                await markBatchResultsSelectedAction(batchId, [
                                  ...selected,
                                ]);
                                const prepared =
                                  await prepareBatchCampaignContactsAction(batchId, [
                                    ...selected,
                                  ]);
                                if (prepared.error || !prepared.contactIds?.length) {
                                  setMessage(prepared);
                                  return;
                                }
                                router.push(
                                  `/campaigns/new?finderBatchId=${batchId}`,
                                );
                              })
                            }
                          >
                            Create New Campaign
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-slate-600">No campaigns yet.</p>
                        <Button
                          type="button"
                          disabled={busy || selected.size === 0}
                          onClick={() =>
                            startTransition(async () => {
                              await markBatchResultsSelectedAction(batchId, [
                                ...selected,
                              ]);
                              const prepared =
                                await prepareBatchCampaignContactsAction(batchId, [
                                  ...selected,
                                ]);
                              if (prepared.error) {
                                setMessage(prepared);
                                return;
                              }
                              router.push(`/campaigns/new?finderBatchId=${batchId}`);
                            })
                          }
                        >
                          Create Campaign
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {batches.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Website lists</CardTitle>
            <CardDescription>
              Reopen a list to review its emails or continue scanning.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-slate-100">
            {batches.map((item) => (
              <Link
                key={item.id}
                href={`/email-finder?batchId=${item.id}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="font-medium text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-500">
                    {item.processedTargets} of {item.totalTargets} websites ·{" "}
                    {item.emailsFound} emails found
                  </p>
                </div>
                <Badge
                  variant={
                    item.status === "running"
                      ? "info"
                      : item.status === "completed"
                        ? "muted"
                        : "warning"
                  }
                >
                  {statusLabel(item.status)}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
