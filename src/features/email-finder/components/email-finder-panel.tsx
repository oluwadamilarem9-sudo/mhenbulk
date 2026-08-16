"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Download, LoaderCircle, Search, UserPlus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CsvImport } from "@/features/contacts/components/csv-import";
import {
  addFinderResultsToCampaignAction,
  addFinderResultsToContactsAction,
  markFinderResultsSelectedAction,
  prepareFinderCampaignContactsAction,
} from "@/features/email-finder/actions";
import { FinderResultsTable } from "@/features/email-finder/components/finder-results-table";
import { exportResultsCsv } from "@/features/email-finder/export-csv";
import { isOwnerGradeEmail } from "@/features/email-finder/score";
import type {
  EmailFinderResultRow,
  EmailFinderScanSummary,
} from "@/features/email-finder/queries";
import type { EmailFinderActionState } from "@/features/email-finder/schemas";

type DraftCampaign = {
  id: string;
  name: string;
  status: string;
};

type Props = {
  initialScan: EmailFinderScanSummary | null;
  initialResults: EmailFinderResultRow[];
  recentScans: EmailFinderScanSummary[];
  draftCampaigns: DraftCampaign[];
};

function sourcePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return "Today";
  if (diff < 2 * day) return "Yesterday";
  return date.toLocaleDateString();
}

export function EmailFinderPanel({
  initialScan,
  initialResults,
  recentScans,
  draftCampaigns,
}: Props) {
  const router = useRouter();
  const [url, setUrl] = useState(initialScan?.targetUrl ?? "");
  const [scan, setScan] = useState<EmailFinderScanSummary | null>(initialScan);
  const [results, setResults] = useState<EmailFinderResultRow[]>(initialResults);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialResults.filter((row) => row.selected).map((row) => row.id)),
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "personal" | "business" | "generic">(
    "all",
  );
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "medium" | "low">(
    "all",
  );
  const [ownerGradeOnly, setOwnerGradeOnly] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scannedPages, setScannedPages] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<EmailFinderActionState | null>(null);
  const [campaignId, setCampaignId] = useState(draftCampaigns[0]?.id ?? "");
  const [showCampaignPicker, setShowCampaignPicker] = useState(false);
  const [busy, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return results.filter((row) => {
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      if (confidenceFilter !== "all" && row.confidence !== confidenceFilter) {
        return false;
      }
      if (ownerGradeOnly && !isOwnerGradeEmail(row.email, row.category)) return false;
      if (!query) return true;
      return (
        row.email.includes(query) ||
        row.domain.toLowerCase().includes(query) ||
        row.sourceUrl.toLowerCase().includes(query) ||
        row.category.includes(query)
      );
    });
  }, [results, search, categoryFilter, confidenceFilter, ownerGradeOnly]);

  const selectedRows = results.filter((row) => selected.has(row.id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of filtered) next.add(row.id);
      return next;
    });
  }

  function deselectAll() {
    setSelected(new Set());
  }

  async function runScan(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setWarning(null);
    setScanning(true);
    setScannedPages([]);
    try {
      const response = await fetch("/api/email-finder/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json()) as {
        error?: string;
        code?: string;
        scan?: EmailFinderScanSummary;
        results?: EmailFinderResultRow[];
        scannedPages?: string[];
        warning?: string | null;
      };

      if (!response.ok || !payload.scan) {
        setScan(null);
        setResults([]);
        setSelected(new Set());
        setMessage({ error: payload.error || "We couldn't complete this scan." });
        return;
      }

      setScan(payload.scan);
      setResults(payload.results ?? []);
      setSelected(new Set());
      setScannedPages(payload.scannedPages ?? []);
      setWarning(payload.warning ?? payload.scan.errorMessage);
      router.replace(`/email-finder?scanId=${payload.scan.id}`);
      router.refresh();
    } catch {
      setMessage({ error: "We couldn't complete this scan. Please try again." });
    } finally {
      setScanning(false);
    }
  }

  function runAction(action: () => Promise<EmailFinderActionState>) {
    startTransition(async () => {
      const result = await action();
      setMessage(result);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Email Finder</CardTitle>
          <CardDescription>
            Find publicly available business emails from a website. Only addresses
            that are already visible on public pages are extracted — nothing is guessed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={runScan} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="website-url">Website URL</Label>
              <Input
                id="website-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com"
                disabled={scanning || busy}
                required
              />
            </div>
            <Button type="submit" disabled={scanning || busy || !url.trim()}>
              {scanning ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Find Emails
                </>
              )}
            </Button>
          </form>
          <p className="text-xs text-slate-500">
            Only use publicly available contact information in accordance with
            applicable laws and the website&apos;s terms. Respect opt-outs and
            unsubscribe requests.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import emails from a file</CardTitle>
          <CardDescription>
            Upload a CSV, TXT, or TSV file to preview and add its valid email
            addresses to Contacts. Existing contacts are skipped automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <CsvImport errorHint="If your file lists websites instead of emails, use “Scan a list of websites” below to find their emails." />
          <p className="text-xs text-slate-500">
            A header row is optional — email addresses are detected automatically.
            CSV and TSV files can also include name, company, phone, tags, and notes
            columns. TXT files should contain one email per line.
          </p>
        </CardContent>
      </Card>

      {message?.error ? <Alert variant="error">{message.error}</Alert> : null}
      {message?.success ? <Alert variant="success">{message.success}</Alert> : null}
      {warning ? <Alert variant="warning">{warning}</Alert> : null}

      {scanning ? (
        <Card>
          <CardHeader>
            <CardTitle>Scanning website...</CardTitle>
            <CardDescription>Finding public email addresses...</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-600">
            <p className="inline-flex items-center gap-2">
              <LoaderCircle className="h-4 w-4 animate-spin text-indigo-600" />
              Checking homepage and priority pages such as Contact, About, and Team.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!scanning && !scan ? (
        <Card>
          <CardContent className="py-10 text-center">
            <h2 className="text-lg font-semibold text-slate-900">
              Find public emails from websites
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Enter a website URL to begin.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {scan && !scanning ? (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              Website: {scan.domain} · Pages scanned: {scan.pagesScanned} · Emails
              found: {scan.emailsFound}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {scan.javascriptHint ? (
              <Alert variant="info">
                Some website content may require JavaScript and could not be scanned.
              </Alert>
            ) : null}

            {results.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center">
                <p className="font-medium text-slate-900">
                  No publicly visible email addresses were found.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Try another website or check whether the site publishes contact emails.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search emails or sources"
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
                      setConfidenceFilter(event.target.value as typeof confidenceFilter)
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
                      checked={ownerGradeOnly}
                      onChange={(event) => setOwnerGradeOnly(event.target.checked)}
                    />
                    Owner-grade only
                  </label>
                </div>

                <FinderResultsTable
                  rows={filtered}
                  selected={selected}
                  onToggle={toggle}
                />

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={selectAllVisible}>
                    Select All
                  </Button>
                  <Button type="button" variant="ghost" onClick={deselectAll}>
                    Deselect All
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || selectedRows.length === 0}
                    onClick={() =>
                      runAction(() =>
                        addFinderResultsToContactsAction(
                          scan.id,
                          [...selected],
                        ),
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
                    onClick={() => exportResultsCsv(selectedRows)}
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
                        <Label htmlFor="finder-campaign">Select Campaign</Label>
                        <select
                          id="finder-campaign"
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
                                addFinderResultsToCampaignAction(
                                  scan.id,
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
                                await markFinderResultsSelectedAction(
                                  scan.id,
                                  [...selected],
                                );
                                const prepared = await prepareFinderCampaignContactsAction(
                                  scan.id,
                                  [...selected],
                                );
                                if (prepared.error || !prepared.contactIds?.length) {
                                  setMessage(prepared);
                                  return;
                                }
                                const params = new URLSearchParams({
                                  finderScanId: scan.id,
                                });
                                router.push(`/campaigns/new?${params.toString()}`);
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
                              await markFinderResultsSelectedAction(
                                scan.id,
                                [...selected],
                              );
                              const prepared = await prepareFinderCampaignContactsAction(
                                scan.id,
                                [...selected],
                              );
                              if (prepared.error) {
                                setMessage(prepared);
                                return;
                              }
                              router.push(`/campaigns/new?finderScanId=${scan.id}`);
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

            {scannedPages.length ? (
              <div className="text-xs text-slate-500">
                Scanned: {scannedPages.map((page) => sourcePath(page)).join(", ")}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {recentScans.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent Searches</CardTitle>
            <CardDescription>Reopen a previous scan to review its results.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-slate-100">
            {recentScans.map((item) => (
              <Link
                key={item.id}
                href={`/email-finder?scanId=${item.id}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="font-medium text-slate-900">{item.domain}</p>
                  <p className="text-sm text-slate-500">
                    {item.emailsFound} emails found · {item.pagesScanned} pages scanned
                  </p>
                </div>
                <div className="text-right text-sm text-slate-500">
                  <Badge variant={item.status === "failed" ? "warning" : "muted"}>
                    {item.status}
                  </Badge>
                  <p className="mt-1">{formatRelativeDate(item.createdAt)}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
