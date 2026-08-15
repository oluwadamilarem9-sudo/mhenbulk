"use client";

import { useActionState, useEffect } from "react";

import {
  createContactAction,
  updateContactAction,
} from "@/features/contacts/actions";
import type { ContactActionState } from "@/features/contacts/schemas";
import type { ContactRow } from "@/features/contacts/queries";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialState: ContactActionState = {};

type ContactFormProps = {
  contact?: ContactRow;
  onDone: () => void;
};

export function ContactForm({ contact, onDone }: ContactFormProps) {
  const action = contact ? updateContactAction : createContactAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      onDone();
    }
  }, [state.success, onDone]);

  return (
    <form action={formAction} className="space-y-4">
      {contact ? <input type="hidden" name="contactId" value={contact.id} /> : null}

      {state.error ? <Alert variant="error">{state.error}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            defaultValue={contact?.first_name}
            placeholder="Jane"
            required
          />
          {state.fieldErrors?.firstName?.[0] ? (
            <p className="text-xs text-rose-600">{state.fieldErrors.firstName[0]}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            name="lastName"
            defaultValue={contact?.last_name}
            placeholder="Doe"
            required
          />
          {state.fieldErrors?.lastName?.[0] ? (
            <p className="text-xs text-rose-600">{state.fieldErrors.lastName[0]}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={contact?.email}
          placeholder="jane@company.com"
          required
        />
        {state.fieldErrors?.email?.[0] ? (
          <p className="text-xs text-rose-600">{state.fieldErrors.email[0]}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="company">Company</Label>
          <Input
            id="company"
            name="company"
            defaultValue={contact?.company ?? ""}
            placeholder="Acme Inc."
          />
          {state.fieldErrors?.company?.[0] ? (
            <p className="text-xs text-rose-600">{state.fieldErrors.company[0]}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={contact?.phone ?? ""}
            placeholder="+1 555 0100"
          />
          {state.fieldErrors?.phone?.[0] ? (
            <p className="text-xs text-rose-600">{state.fieldErrors.phone[0]}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          name="status"
          defaultValue={contact?.status ?? "active"}
          className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20"
        >
          <option value="active">Active</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="bounced">Bounced</option>
          <option value="invalid">Invalid</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={contact?.notes ?? ""}
          placeholder="Context, preferences, or follow-up notes..."
        />
        {state.fieldErrors?.notes?.[0] ? (
          <p className="text-xs text-rose-600">{state.fieldErrors.notes[0]}</p>
        ) : null}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving..."
            : contact
              ? "Save changes"
              : "Add contact"}
        </Button>
      </div>
    </form>
  );
}
