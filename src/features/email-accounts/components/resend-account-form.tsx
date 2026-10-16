"use client";

import { useActionState } from "react";

import {
  connectResendAccountAction,
  updateResendAccountAction,
} from "@/features/email-accounts/actions";
import type {
  EmailAccountActionState,
  EmailAccountPublic,
} from "@/features/email-accounts/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: EmailAccountActionState = {};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-rose-600">{message}</p>;
}

export function ResendConnectForm() {
  const [state, action, pending] = useActionState(
    connectResendAccountAction,
    initialState,
  );

  return (
    <form
      action={action}
      className="space-y-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5"
    >
      <div>
        <p className="text-sm font-medium text-slate-900">Resend</p>
        <p className="mt-1 text-sm text-slate-500">
          The sender address must be on a domain you already verified in Resend.
          The API key is encrypted on the server and is not shown again.
        </p>
      </div>
      <AccountFields state={state} idPrefix="resend-connect" apiKeyRequired />
      {state.error ? <p className="text-sm text-rose-600">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Checking..." : "Connect Resend"}
      </Button>
    </form>
  );
}

export function ResendEditForm({ account }: { account: EmailAccountPublic }) {
  const [state, action, pending] = useActionState(
    updateResendAccountAction,
    initialState,
  );

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="accountId" value={account.id} />
      <AccountFields
        state={state}
        idPrefix={`resend-${account.id}`}
        defaultEmail={account.email}
        defaultDisplayName={account.display_name ?? ""}
      />
      {state.error ? <p className="text-sm text-rose-600">{state.error}</p> : null}
      {state.success ? (
        <p className="text-sm text-emerald-700">{state.success}</p>
      ) : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Checking..." : "Save Resend account"}
      </Button>
    </form>
  );
}

function AccountFields({
  state,
  idPrefix,
  apiKeyRequired = false,
  defaultEmail = "",
  defaultDisplayName = "",
}: {
  state: EmailAccountActionState;
  idPrefix: string;
  apiKeyRequired?: boolean;
  defaultEmail?: string;
  defaultDisplayName?: string;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-display-name`}>Sender display name</Label>
        <Input
          id={`${idPrefix}-display-name`}
          name="displayName"
          required
          maxLength={200}
          defaultValue={defaultDisplayName}
          autoComplete="name"
        />
        <FieldError message={state.fieldErrors?.displayName?.[0]} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-email`}>Verified sender email</Label>
        <Input
          id={`${idPrefix}-email`}
          name="email"
          type="email"
          required
          maxLength={320}
          defaultValue={defaultEmail}
          autoComplete="email"
          placeholder="hello@mhenbulk.store"
        />
        <FieldError message={state.fieldErrors?.email?.[0]} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-api-key`}>Resend API key</Label>
        <Input
          id={`${idPrefix}-api-key`}
          name="apiKey"
          type="password"
          required={apiKeyRequired}
          autoComplete="new-password"
          spellCheck={false}
          placeholder={
            apiKeyRequired ? "re_..." : "Leave blank to keep the saved key"
          }
        />
        <FieldError message={state.fieldErrors?.apiKey?.[0]} />
      </div>
    </>
  );
}
