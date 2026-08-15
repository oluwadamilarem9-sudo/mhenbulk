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
