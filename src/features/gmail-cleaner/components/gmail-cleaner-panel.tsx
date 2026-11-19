"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  cancelGmailScanAction,
  processGmailScanChunkAction,
  restoreGmailCleanerItemsAction,
  selectCategoryForCleanupAction,
  setGmailCleanerSelectionAction,
  startGmailScanAction,
  trashSelectedGmailMessagesAction,
} from "@/features/gmail-cleaner/actions";
import {
  CATEGORY_LABELS,
  NON_SELECTABLE_CATEGORIES,
  type GmailCleanerCategory,
} from "@/features/gmail-cleaner/classify";
import type {
  GmailCleanerAccountOption,
  GmailCleanerMessageRow,
  GmailCleanerOperationItem,
  GmailCleanerOperationSummary,
  GmailCleanerScanSummary,
} from "@/features/gmail-cleaner/queries";
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

const linkButtonClass =
  "inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500";
const linkSecondaryClass =
  "inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-slate-900 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50";

type Props = {
  accounts: GmailCleanerAccountOption[];
  selectedAccountId: string | null;
  scan: GmailCleanerScanSummary | null;
  messages: GmailCleanerMessageRow[];
  operations: GmailCleanerOperationSummary[];
  operationItems: GmailCleanerOperationItem[];
  selectedOperationId: string | null;
  initialCategory?: string | null;
  initialQuery?: string | null;
  flash?: { kind: "error" | "success"; message: string } | null;
};

const CATEGORIES = Object.keys(CATEGORY_LABELS) as GmailCleanerCategory[];

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function GmailCleanerPanel({
  accounts,
  selectedAccountId,
  scan,
  messages,
  operations,
  operationItems,
  selectedOperationId,
  initialCategory,
  initialQuery,
  flash,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const accountId = selectedAccountId ?? accounts[0]?.id ?? "";
  const [message, setMessage] = useState(flash?.message ?? "");
  const [messageKind, setMessageKind] = useState<"error" | "success">(
    flash?.kind ?? "success",
  );
  const scanning =
    scan?.status === "pending" || scan?.status === "running";
  const [progress, setProgress] = useState({
    processed: scan?.messagesProcessed ?? 0,
    total: scan?.totalEstimate ?? null as number | null,
  });
  const pumpRef = useRef(false);
  const selectedAccount = accounts.find((account) => account.id === accountId);

  useEffect(() => {
    if (!scan || !scanning) return;
    if (pumpRef.current) return;
    pumpRef.current = true;

    let cancelled = false;

    async function pump(scanId: string) {
      while (!cancelled) {
        const result = await processGmailScanChunkAction(scanId);
        if (cancelled) break;
        if (result.error) {
          setMessageKind("error");
          setMessage(result.error);
          pumpRef.current = false;
          router.refresh();
          return;
        }
        setProgress({
          processed: result.processed ?? 0,
          total: result.totalEstimate ?? null,
        });
        if (result.done) {
          setMessageKind("success");
          setMessage(result.success ?? "Scan finished.");
          pumpRef.current = false;
          router.refresh();
          return;
        }
      }
      pumpRef.current = false;
    }

    void pump(scan.id);
    return () => {
      cancelled = true;
      pumpRef.current = false;
    };
  }, [scan, scanning, router]);

  // Authoritative eligible selection count from the scan (not the filtered page).
  // Page-local checkboxes can still differ under filters; never fall back with `||`
  // from a filtered zero up to an unrelated stale total.
  const selectedCount = useMemo(() => {
    if (typeof scan?.selectedCount === "number") {
      return scan.selectedCount;
    }
    return messages.filter(
      (row) =>
        row.selected &&
        row.protectionStatus !== "protected" &&
        !row.isDraft &&
        !row.isSent &&
        !row.isSpam &&
        !row.isTrash,
    ).length;
  }, [messages, scan?.selectedCount]);

  function withAccount(path: string) {
    const params = new URLSearchParams();
    if (accountId) params.set("accountId", accountId);
    if (scan?.id) params.set("scanId", scan.id);
    if (initialCategory) params.set("category", initialCategory);
    if (initialQuery) params.set("q", initialQuery);
    return `${path}?${params.toString()}`;
  }

  function startScan() {
    if (!accountId) {
      setMessageKind("error");
      setMessage("Connect or select a Gmail account first.");
      return;
    }
    if (selectedAccount && !selectedAccount.hasModifyScope) {
      setMessageKind("error");
      setMessage(
        "This Gmail account still needs mailbox permission before scanning.",
      );
      return;
    }
    startTransition(async () => {
      const result = await startGmailScanAction(accountId);
      if (result.error) {
        setMessageKind("error");
        setMessage(result.error);
        return;
      }
      setMessageKind("success");
      setMessage(result.success ?? "Scan started.");
      router.push(
        `/gmail-cleaner?accountId=${encodeURIComponent(accountId)}&scanId=${encodeURIComponent(result.scanId ?? "")}`,
      );
      router.refresh();
    });
  }

  function cancelScan() {
    if (!scan) return;
    startTransition(async () => {
      const result = await cancelGmailScanAction(scan.id);
      setMessageKind(result.error ? "error" : "success");
      setMessage(result.error ?? result.success ?? "Cancelled.");
      router.refresh();
    });
  }

  function toggleRow(row: GmailCleanerMessageRow, selected: boolean) {
    if (!scan) return;
    startTransition(async () => {
      const result = await setGmailCleanerSelectionAction(
        scan.id,
        [row.gmailMessageId],
        selected,
      );
      if (result.error) {
        setMessageKind("error");
        setMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  function selectCategory(category: GmailCleanerCategory, selected: boolean) {
    if (!scan) return;
    startTransition(async () => {
      const result = await selectCategoryForCleanupAction(
        scan.id,
        category,
        selected,
      );
      if (result.error) {
        setMessageKind("error");
        setMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  function runCleanup() {
    if (!scan) return;
    const ok = window.confirm(
      `Move ${selectedCount} selected email(s) to Gmail Trash?\n\n` +
        `Protected, draft, sent, Spam, and already-trashed messages stay excluded.\n` +
        `Emails are moved to Trash (not permanently deleted).`,
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await trashSelectedGmailMessagesAction(scan.id, true);
      setMessageKind(result.error ? "error" : "success");
      setMessage(result.error ?? result.success ?? "Cleanup finished.");
      if (result.operationId) {
        router.push(
          `/gmail-cleaner?accountId=${encodeURIComponent(accountId)}&scanId=${encodeURIComponent(scan.id)}&operationId=${encodeURIComponent(result.operationId)}`,
        );
      }
      router.refresh();
    });
  }

  function restoreSelected(itemIds: string[]) {
    if (!selectedOperationId || itemIds.length === 0) return;
    const ok = window.confirm(
      `Restore ${itemIds.length} message(s) that Mhenbulk moved to Trash?`,
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await restoreGmailCleanerItemsAction(
        selectedOperationId,
        itemIds,
      );
      setMessageKind(result.error ? "error" : "success");
      setMessage(result.error ?? result.success ?? "Restore finished.");
      router.refresh();
    });
  }

  const grantUrl = `/api/auth/google/start?intent=cleaner&returnTo=${encodeURIComponent("/gmail-cleaner")}`;

  return (
    <div className="space-y-6">
      {message ? (
        <Alert variant={messageKind === "error" ? "error" : "success"}>
          {message}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Gmail account</CardTitle>
          <CardDescription>
            Scan uses your connected Gmail account. Campaign sending keeps working
            with existing permissions. Mailbox access requires the restricted{" "}
            <code className="text-xs">gmail.modify</code> scope and explicit consent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {accounts.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                No Gmail account is connected yet.
              </p>
              <Link href={grantUrl} className={linkButtonClass}>
                Connect Gmail for Cleaner
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  Account
                </span>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={accountId}
                  onChange={(event) => {
                    router.push(
                      `/gmail-cleaner?accountId=${encodeURIComponent(event.target.value)}`,
                    );
                  }}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.email}
                      {account.hasModifyScope ? "" : " (needs mailbox permission)"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                {selectedAccount && !selectedAccount.hasModifyScope ? (
                  <Link href={grantUrl} className={linkSecondaryClass}>
                    Grant mailbox permission
                  </Link>
                ) : null}
                <Button
                  onClick={startScan}
                  disabled={pending || scanning || !accountId}
                >
                  {scanning ? "Scanning…" : "Scan Gmail"}
                </Button>
                {scanning ? (
                  <Button
                    variant="ghost"
                    onClick={cancelScan}
                    disabled={pending}
                  >
                    Cancel scan
                  </Button>
                ) : null}
              </div>
            </div>
          )}

          {selectedAccount && !selectedAccount.hasModifyScope ? (
            <Alert variant="warning">
              This connection can send campaign email, but it cannot scan or trash
              mailbox messages until you grant additional Gmail permission. Existing
              sending stays intact if you cancel the permission request.
            </Alert>
          ) : null}

          {scanning || scan?.status === "running" ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Scanning… processed {progress.processed}
              {progress.total != null ? ` of ~${progress.total}` : ""} messages.
              You can leave this page; reopen Gmail Cleaner to continue progress.
            </div>
          ) : null}

          {scan?.errorMessage ? (
            <Alert variant="warning">{scan.errorMessage}</Alert>
          ) : null}
        </CardContent>
      </Card>

      {scan ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                [
                  "Scanned",
                  scan.messagesProcessed,
                  "Unique Gmail messages loaded in this scan.",
                ],
                [
                  "Potential clutter",
                  scan.clutterCount,
                  "Eligible cleanup candidates (suggested Trash).",
                ],
                [
                  "Protected",
                  scan.protectedCount,
                  "Starred, Important, drafts, sent, or sensitive mail.",
                ],
                [
                  "Manual review",
                  scan.needsReviewCount,
                  "Uncertain messages suggested for manual review — not auto-selected.",
                ],
                [
                  "Already in Spam",
                  scan.spamCount,
                  "Mailbox Spam label — reported separately, not new cleanup.",
                ],
                [
                  "Already in Trash",
                  scan.trashCount,
                  "Mailbox Trash label — reported separately, not new cleanup.",
                ],
                [
                  "Selected",
                  selectedCount,
                  "Currently selected eligible message IDs for cleanup.",
                ],
                [
                  "Last scan",
                  scan.completedAt ? formatDate(scan.completedAt) : scan.status,
                  "Latest scan completion time or status.",
                ],
              ] as const
            ).map(([label, value, hint]) => (
              <Card key={String(label)}>
                <CardContent className="pt-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{hint}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Category statistics</CardTitle>
              <CardDescription>
                One primary bucket per message for {scan.accountEmail || "this account"}.
                “Uncertain / needs review” is the classification category; “Manual review”
                above counts only messages still suggested for review (not already in
                Spam/Trash).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {CATEGORIES.map((category) => (
                  <div
                    key={category}
                    className="rounded-xl border border-slate-200 px-3 py-3"
                  >
                    <p className="text-xs text-slate-500">
                      {CATEGORY_LABELS[category]}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">
                      {scan.categoryCounts[category] ?? 0}
                    </p>
                    {!NON_SELECTABLE_CATEGORIES.has(category) ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          className="text-xs text-indigo-600 hover:underline"
                          onClick={() => selectCategory(category, true)}
                        >
                          Select
                        </button>
                        <button
                          type="button"
                          className="text-xs text-slate-500 hover:underline"
                          onClick={() => selectCategory(category, false)}
                        >
                          Clear
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Review suggestions</CardTitle>
                <CardDescription>
                  Only selected, non-protected messages can be moved to Gmail Trash.
                </CardDescription>
              </div>
              <Button
                variant="danger"
                disabled={pending || selectedCount === 0}
                onClick={runCleanup}
              >
                Move selected to Trash ({selectedCount})
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                action="/gmail-cleaner"
                method="get"
              >
                <input type="hidden" name="accountId" value={accountId} />
                <input type="hidden" name="scanId" value={scan.id} />
                <Input
                  name="q"
                  defaultValue={initialQuery ?? ""}
                  placeholder="Search sender or subject"
                />
                <select
                  name="category"
                  defaultValue={initialCategory ?? ""}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">All categories</option>
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
                <select
                  name="action"
                  defaultValue=""
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">All suggestions</option>
                  <option value="trash">Recommended cleanup</option>
                  <option value="review">Needs review</option>
                  <option value="keep">Keep / protected</option>
                </select>
                <Button type="submit" variant="secondary">
                  Filter
                </Button>
              </form>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Select</th>
                      <th className="px-3 py-2">Sender</th>
                      <th className="px-3 py-2">Subject</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Why</th>
                      <th className="px-3 py-2">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-8 text-center text-slate-500"
                        >
                          No messages match these filters yet.
                        </td>
                      </tr>
                    ) : (
                      messages.map((row) => {
                        const locked =
                          row.protectionStatus === "protected" ||
                          row.isDraft ||
                          row.isSent ||
                          row.isSpam ||
                          row.isTrash;
                        return (
                          <tr
                            key={row.id}
                            className="border-t border-slate-100 align-top"
                          >
                            <td className="px-3 py-3">
                              <input
                                type="checkbox"
                                checked={row.selected}
                                disabled={locked || pending}
                                onChange={(event) =>
                                  toggleRow(row, event.target.checked)
                                }
                              />
                            </td>
                            <td className="px-3 py-3">
                              <div className="font-medium text-slate-900">
                                {row.senderName || row.senderEmail || "Unknown"}
                              </div>
                              <div className="text-xs text-slate-500">
                                {row.senderEmail}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="text-slate-900">
                                {row.subject || "(no subject)"}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {row.labelIds.slice(0, 4).map((label) => (
                                  <Badge key={label}>{label}</Badge>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                              {formatDate(row.messageDate)}
                            </td>
                            <td className="px-3 py-3">
                              <Badge>{row.categoryLabel}</Badge>
                              <div className="mt-1 text-xs text-slate-500">
                                {row.isSpam
                                  ? "Already Spam"
                                  : row.isTrash
                                    ? "Already Trash"
                                    : row.protectionStatus === "protected"
                                      ? "Protected"
                                      : row.suggestedAction === "trash"
                                        ? "Recommended cleanup"
                                        : "Needs review"}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-slate-600">
                              {row.classificationReason}
                            </td>
                            <td className="px-3 py-3 capitalize text-slate-600">
                              {row.confidence}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Cleanup history</CardTitle>
          <CardDescription>
            Auditable record of messages Mhenbulk moved to Trash. Restore only
            applies to those items while Gmail still allows untrash.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {operations.length === 0 ? (
            <p className="text-sm text-slate-500">No cleanup operations yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Selected</th>
                    <th className="px-3 py-2">Trashed</th>
                    <th className="px-3 py-2">Failed</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {operations.map((operation) => (
                    <tr
                      key={operation.id}
                      className="border-t border-slate-100"
                    >
                      <td className="px-3 py-3 whitespace-nowrap">
                        {formatDate(operation.createdAt)}
                      </td>
                      <td className="px-3 py-3">{operation.accountEmail}</td>
                      <td className="px-3 py-3">{operation.selectedCount}</td>
                      <td className="px-3 py-3">{operation.successCount}</td>
                      <td className="px-3 py-3">{operation.failedCount}</td>
                      <td className="px-3 py-3 capitalize">{operation.status}</td>
                      <td className="px-3 py-3">
                        <Link
                          className="text-indigo-600 hover:underline"
                          href={`/gmail-cleaner?accountId=${encodeURIComponent(accountId)}&operationId=${encodeURIComponent(operation.id)}`}
                        >
                          Inspect
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selectedOperationId && operationItems.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Operation details
                </h3>
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    restoreSelected(
                      operationItems
                        .filter(
                          (item) =>
                            item.status === "trashed" &&
                            !item.wasAlreadyTrash &&
                            !item.restoredAt,
                        )
                        .map((item) => item.id),
                    )
                  }
                >
                  Restore recoverable
                </Button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Sender</th>
                      <th className="px-3 py-2">Subject</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationItems.map((item) => (
                      <tr
                        key={item.id}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-3">{item.senderEmail || "—"}</td>
                        <td className="px-3 py-3">
                          {item.subject || "(no subject)"}
                        </td>
                        <td className="px-3 py-3">
                          {item.primaryCategory || "—"}
                        </td>
                        <td className="px-3 py-3 capitalize">{item.status}</td>
                        <td className="px-3 py-3 text-slate-500">
                          {item.wasAlreadyTrash
                            ? "Already in Trash before cleanup"
                            : item.errorMessage ||
                              (item.restoredAt
                                ? `Restored ${formatDate(item.restoredAt)}`
                                : "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <p className="text-xs text-slate-500">
            Production Google Cloud projects may need OAuth verification for the
            restricted <code>gmail.modify</code> scope. Verification is not claimed
            complete by this app.
          </p>
          <p className="text-xs text-slate-500">
            <Link href={withAccount("/gmail-cleaner")} className="text-indigo-600">
              Refresh this view
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
