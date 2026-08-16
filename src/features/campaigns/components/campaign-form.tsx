"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";

import {
  createCampaignAction,
  updateCampaignAction,
} from "@/features/campaigns/actions";
import type { CampaignActionState } from "@/features/campaigns/schemas";
import type { CampaignRow } from "@/features/campaigns/queries";
import type { EmailAccountPublic } from "@/features/email-accounts/schemas";
import { SenderAccountSelect } from "@/features/email-accounts/components/sender-account-select";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/features/campaigns/components/rich-text-editor";
import { contactDisplayName } from "@/features/contacts/format";

const initialState: CampaignActionState = {};

type CampaignFormProps = {
  campaign?: CampaignRow;
  emailAccounts: EmailAccountPublic[];
  availableContacts?: Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
  }>;
};

export function CampaignForm({
  campaign,
  emailAccounts,
  availableContacts = [],
}: CampaignFormProps) {
  const router = useRouter();
  const action = campaign ? updateCampaignAction : createCampaignAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {campaign ? <input type="hidden" name="campaignId" value={campaign.id} /> : null}

      {state.error ? <Alert variant="error">{state.error}</Alert> : null}
      {state.success ? <Alert variant="success">{state.success}</Alert> : null}

      <SenderAccountSelect
        accounts={emailAccounts}
        defaultValue={campaign?.email_account_id}
        disabled={pending}
        error={state.fieldErrors?.emailAccountId?.[0]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Campaign name</Label>
          <Input
            id="name"
            name="name"
            defaultValue={campaign?.name}
            placeholder="August newsletter"
            required
          />
          <p className="text-xs text-slate-500">
            For your own organization only — recipients do not see this.
          </p>
          {state.fieldErrors?.name?.[0] ? (
            <p className="text-xs text-rose-600">{state.fieldErrors.name[0]}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="subject">
            Email subject{" "}
            <span className="font-normal text-slate-400">(optional)</span>
          </Label>
          <Input
            id="subject"
            name="subject"
            defaultValue={
              campaign?.subject?.replaceAll("\u200B", "").trim() || ""
            }
            placeholder="Hi {{first_name}}, here's what's new"
          />
          <p className="text-xs text-slate-500">
            What people see in their inbox. Leave blank for no subject — the
            campaign name is never used here.
          </p>
          {state.fieldErrors?.subject?.[0] ? (
            <p className="text-xs text-rose-600">{state.fieldErrors.subject[0]}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Email message</Label>
        <RichTextEditor
          name="htmlContent"
          initialValue={campaign?.html_content}
          placeholder="Write the email you want people to receive..."
        />
        {state.fieldErrors?.htmlContent?.[0] ? (
          <p className="text-xs text-rose-600">{state.fieldErrors.htmlContent[0]}</p>
        ) : null}
        <p className="text-xs text-slate-500">
          Format your message with the toolbar and insert personalization with one
          click. Recipients see exactly this — nothing is appended to the body.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="textContent">
          Plain-text version <span className="font-normal text-slate-400">(optional)</span>
        </Label>
        <Textarea
          id="textContent"
          name="textContent"
          defaultValue={campaign?.text_content ?? ""}
          placeholder="Hello {{first_name}}, write a no-formatting fallback here if you want one..."
          rows={5}
        />
        {state.fieldErrors?.textContent?.[0] ? (
          <p className="text-xs text-rose-600">{state.fieldErrors.textContent[0]}</p>
        ) : null}
        <p className="text-xs text-slate-500">
          Skip this unless you want a separate no-formatting version for inboxes that
          cannot show HTML. Most people can leave it empty.
        </p>
      </div>

      {!campaign ? (
        <fieldset className="space-y-2">
          <legend className="font-medium text-slate-900">
            Initial recipients <span className="font-normal text-slate-400">(optional)</span>
          </legend>
          <p className="text-xs text-slate-500">
            Choose existing eligible contacts now, or add/import recipients after
            creating the campaign.
          </p>
          <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {availableContacts.length ? (
              availableContacts.map((contact) => (
                <label
                  key={contact.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <input type="checkbox" name="contactIds" value={contact.id} />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">
                      {contactDisplayName(contact.first_name, contact.last_name) ||
                        contact.email}
                    </span>
                    <span className="block truncate text-slate-500">
                      {contact.email}
                    </span>
                  </span>
                </label>
              ))
            ) : (
              <p className="p-4 text-sm text-slate-500">
                No eligible contacts yet. You can add or import them in the next step.
              </p>
            )}
          </div>
        </fieldset>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending || emailAccounts.length === 0}>
          {pending
            ? "Saving..."
            : campaign
              ? "Save changes"
              : "Create campaign"}
        </Button>
      </div>
    </form>
  );
}
