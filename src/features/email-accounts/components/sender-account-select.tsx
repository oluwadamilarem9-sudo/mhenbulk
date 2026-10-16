"use client";

import type { EmailAccountPublic } from "@/features/email-accounts/schemas";
import {
  preferredSenderAccountId,
  selectableSenderAccounts,
  senderOptionLabel,
} from "@/features/email-accounts/sender-eligibility";
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
  const selectable = selectableSenderAccounts(accounts);
  const selectedId = preferredSenderAccountId(accounts, defaultValue);

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>Sending account</Label>
      {selectable.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Connect Gmail, Resend, or MisarMail in Settings before you can send
          campaigns.{" "}
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
          defaultValue={selectedId}
          className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selectable.map((account) => (
            <option key={account.id} value={account.id}>
              {senderOptionLabel(account)}
            </option>
          ))}
        </select>
      )}
      <p className="text-xs text-slate-500">
        Recipients will see the selected account&apos;s address as the sender.
        You cannot type a different From address.
      </p>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
