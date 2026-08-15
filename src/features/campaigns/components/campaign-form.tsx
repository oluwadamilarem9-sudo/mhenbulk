"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";

import {
  createCampaignAction,
  updateCampaignAction,
} from "@/features/campaigns/actions";
import type { CampaignActionState } from "@/features/campaigns/schemas";
import type { CampaignRow } from "@/features/campaigns/queries";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/features/campaigns/components/rich-text-editor";

const initialState: CampaignActionState = {};

type CampaignFormProps = {
  campaign?: CampaignRow;
};

export function CampaignForm({ campaign }: CampaignFormProps) {
  const router = useRouter();
  const action = campaign ? updateCampaignAction : createCampaignAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {campaign ? <input type="hidden" name="campaignId" value={campaign.id} /> : null}

      {state.error ? <Alert variant="error">{state.error}</Alert> : null}
      {state.success ? <Alert variant="success">{state.success}</Alert> : null}

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
            Email subject <span className="font-normal text-slate-400">(optional)</span>
          </Label>
          <Input
            id="subject"
            name="subject"
            defaultValue={campaign?.subject}
            placeholder="Hi {{first_name}}, here's what's new"
          />
          <p className="text-xs text-slate-500">
            What people see in their inbox. If left blank, the campaign name is used.
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
          click. An unsubscribe link is added automatically.
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

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
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
