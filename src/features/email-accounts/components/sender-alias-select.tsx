"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";

import { listSendAsAliasesAction } from "@/features/campaigns/send-as-actions";
import { gmailAliasReconnectPath } from "@/lib/google/scopes";
import { Label } from "@/components/ui/label";

type AliasOption = {
  email: string;
  displayName: string | null;
  replyToAddress: string | null;
  isPrimary: boolean;
  isDefault: boolean;
};

type InventoryItem = {
  email: string;
  displayName: string | null;
  isPrimary: boolean;
  isDefault: boolean;
  usable: boolean;
  statusLabel: string;
  verificationStatus: string | null;
};

type SenderAliasSelectProps = {
  emailAccountId: string | null;
  defaultFromEmail?: string | null;
  disabled?: boolean;
  error?: string;
};

type AliasLoadState = {
  accountId: string | null;
  accountEmail: string | null;
  aliases: AliasOption[];
  inventory: InventoryItem[];
  warning: string | null;
  loadError: string | null;
  selected: string;
  diagnostics: {
    hasListScopeInDb: boolean;
    httpStatus: number | null;
    returnedCount: number;
    usableCount: number;
  } | null;
};

export function SenderAliasSelect({
  emailAccountId,
  defaultFromEmail,
  disabled,
  error,
}: SenderAliasSelectProps) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AliasLoadState>({
    accountId: null,
    accountEmail: null,
    aliases: [],
    inventory: [],
    warning: null,
    loadError: null,
    selected: defaultFromEmail ?? "",
    diagnostics: null,
  });

  useEffect(() => {
    if (!emailAccountId) return;

    let cancelled = false;
    startTransition(async () => {
      const result = await listSendAsAliasesAction(emailAccountId);
      if (cancelled) return;
      if (result.error) {
        setState({
          accountId: emailAccountId,
          accountEmail: null,
          aliases: [],
          inventory: [],
          warning: null,
          loadError: result.error,
          selected: "",
          diagnostics: null,
        });
        return;
      }
      const aliases = result.aliases ?? [];
      const preferred =
        result.preferredEmail &&
        aliases.some((alias) => alias.email === result.preferredEmail)
          ? result.preferredEmail
          : defaultFromEmail &&
              aliases.some((alias) => alias.email === defaultFromEmail)
            ? defaultFromEmail
            : aliases[0]?.email ?? "";
      setState({
        accountId: result.accountId ?? emailAccountId,
        accountEmail: result.accountEmail ?? null,
        aliases,
        inventory: result.inventory ?? [],
        warning: result.warning ?? null,
        loadError: null,
        selected: preferred,
        diagnostics: result.diagnostics ?? null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [emailAccountId, defaultFromEmail]);

  if (!emailAccountId) return null;

  // While loading a newly selected account, never show the previous account's aliases.
  const isCurrent = state.accountId === emailAccountId;
  const aliases = isCurrent ? state.aliases : [];
  const inventory = isCurrent ? state.inventory : [];
  const warning = isCurrent ? state.warning : null;
  const loadError = isCurrent ? state.loadError : null;
  const selected = isCurrent ? state.selected : defaultFromEmail ?? "";
  const accountEmail = isCurrent ? state.accountEmail : null;
  const diagnostics = isCurrent ? state.diagnostics : null;
  const excluded = inventory.filter((item) => !item.usable);
  const needsAliasPermission =
    Boolean(warning?.toLowerCase().includes("gmail.modify")) ||
    diagnostics?.httpStatus === 403 ||
    diagnostics?.hasListScopeInDb === false;
  const reconnectHref = gmailAliasReconnectPath(pathname || "/campaigns/new");

  return (
    <div className="space-y-2">
      <Label htmlFor="fromEmail">Choose sending address</Label>
      <select
        id="fromEmail"
        name="fromEmail"
        required
        disabled={disabled || pending || aliases.length === 0}
        value={selected}
        onChange={(event) =>
          setState((current) => ({
            ...current,
            selected: event.target.value,
          }))
        }
        className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {aliases.length === 0 ? (
          <option value="">
            {pending
              ? "Loading sending addresses for this account…"
              : "No verified sending addresses"}
          </option>
        ) : (
          aliases.map((alias) => (
            <option key={alias.email} value={alias.email}>
              {alias.displayName
                ? `${alias.displayName} <${alias.email}>`
                : alias.email}
              {alias.isPrimary ? " (primary)" : ""}
              {alias.isDefault && !alias.isPrimary ? " (Gmail default)" : ""}
            </option>
          ))
        )}
      </select>
      <p className="text-xs text-slate-500">
        Aliases are loaded from Gmail for{" "}
        <span className="font-medium text-slate-700">
          {accountEmail ?? "the selected account"}
        </span>{" "}
        only. Unverified identities cannot be selected.
      </p>
      {needsAliasPermission ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p>
            Domain aliases need mailbox permission on{" "}
            <span className="font-medium">
              {accountEmail ?? "this Gmail account"}
            </span>
            . A normal “Reconnect Gmail” from Settings only grants send access
            and is not enough.
          </p>
          <p className="mt-2">
            <Link
              href={reconnectHref}
              className="font-medium text-amber-950 underline underline-offset-2"
            >
              Grant send-as permission (gmail.modify)
            </Link>{" "}
            for this exact account, approve mailbox access in Google, then
            return here.
          </p>
        </div>
      ) : null}
      {warning && !needsAliasPermission ? (
        <p className="text-xs text-amber-700">{warning}</p>
      ) : null}
      {warning && needsAliasPermission ? (
        <p className="text-xs text-amber-800">{warning}</p>
      ) : null}
      {loadError ? <p className="text-xs text-rose-600">{loadError}</p> : null}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      {excluded.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p className="font-medium text-slate-700">
            Identities returned by Gmail but not available for sending
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {excluded.map((item) => (
              <li key={item.email}>
                {item.email}: {item.statusLabel}
                {item.verificationStatus
                  ? ` (verificationStatus=${item.verificationStatus})`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {diagnostics ? (
        <p className="text-[11px] text-slate-400">
          Debug: http={diagnostics.httpStatus ?? "—"}, returned=
          {diagnostics.returnedCount}, usable={diagnostics.usableCount},
          listScopeInDb={diagnostics.hasListScopeInDb ? "yes" : "no"}
        </p>
      ) : null}
    </div>
  );
}
