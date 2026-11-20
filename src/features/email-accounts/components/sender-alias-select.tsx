"use client";

import { useEffect, useState, useTransition } from "react";

import { listSendAsAliasesAction } from "@/features/campaigns/send-as-actions";
import { Label } from "@/components/ui/label";

type AliasOption = {
  email: string;
  displayName: string | null;
  replyToAddress: string | null;
  isPrimary: boolean;
  isDefault: boolean;
};

type SenderAliasSelectProps = {
  emailAccountId: string | null;
  defaultFromEmail?: string | null;
  disabled?: boolean;
  error?: string;
};

type AliasLoadState = {
  accountId: string | null;
  aliases: AliasOption[];
  warning: string | null;
  loadError: string | null;
  selected: string;
};

export function SenderAliasSelect({
  emailAccountId,
  defaultFromEmail,
  disabled,
  error,
}: SenderAliasSelectProps) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AliasLoadState>({
    accountId: null,
    aliases: [],
    warning: null,
    loadError: null,
    selected: defaultFromEmail ?? "",
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
          aliases: [],
          warning: null,
          loadError: result.error,
          selected: "",
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
        accountId: emailAccountId,
        aliases,
        warning: result.warning ?? null,
        loadError: null,
        selected: preferred,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [emailAccountId, defaultFromEmail]);

  if (!emailAccountId) return null;

  const aliases =
    state.accountId === emailAccountId ? state.aliases : [];
  const warning =
    state.accountId === emailAccountId ? state.warning : null;
  const loadError =
    state.accountId === emailAccountId ? state.loadError : null;
  const selected =
    state.accountId === emailAccountId
      ? state.selected
      : defaultFromEmail ?? "";

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
            {pending ? "Loading sending addresses…" : "No sending addresses"}
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
        Only verified Gmail “Send mail as” identities from this connected account
        can be used. The account stays the authenticated sender; the From header
        uses the selected address.
      </p>
      {warning ? (
        <p className="text-xs text-amber-700">{warning}</p>
      ) : null}
      {loadError ? <p className="text-xs text-rose-600">{loadError}</p> : null}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
