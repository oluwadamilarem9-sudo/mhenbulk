"use client";

import type { EmailAccountPublic } from "@/features/email-accounts/schemas";
import { Label } from "@/components/ui/label";

type SenderAccountSelectProps = {
  accounts: EmailAccountPublic[];
  name?: string;
  defaultValue?: string | null;
  disabled?: boolean;
  error?: string;
};

export function SenderAccountSelect({
  accounts,
  name = "emailAccountId",
  defaultValue,
  disabled,
  error,
}: SenderAccountSelectProps) {
  const selectable = accounts.filter(
    (account) =>
      account.provider === "gmail" &&
      (account.status === "connected" || account.status === "rate_limited"),
  );

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>Sending account</Label>
      {selectable.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Connect Gmail in Settings before you can send campaigns.{" "}
          <a href="/settings/email-accounts" className="font-medium underline">
            Connect Gmail
          </a>
        </div>
      ) : (
        <select
          id={name}
          name={name}
          required
          disabled={disabled}
          defaultValue={defaultValue ?? selectable[0]?.id}
          className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selectable.map((account) => (
            <option key={account.id} value={account.id}>
              {account.display_name
                ? `${account.display_name} <${account.email}>`
                : account.email}
            </option>
          ))}
        </select>
      )}
      <p className="text-xs text-slate-500">
        Recipients will see this Gmail address as the sender. You cannot type a
        different From address.
      </p>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
