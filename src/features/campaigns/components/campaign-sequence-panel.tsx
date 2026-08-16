"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Bot, CalendarClock, Clock3, Send, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelFollowupAction,
  saveFollowupAction,
  setCampaignAutomationAction,
} from "@/features/campaigns/actions";
import { RichTextEditor } from "@/features/campaigns/components/rich-text-editor";
import type { CampaignMember, CampaignStep } from "@/features/campaigns/queries";
import type { CampaignActionState } from "@/features/campaigns/schemas";
import { subjectForDisplay } from "@/features/campaigns/schemas";
import { contactDisplayName } from "@/features/contacts/format";

type Props = {
  campaignId: string;
  campaignStatus: string;
  automationEnabled: boolean;
  campaignTimezone: string;
  steps: CampaignStep[];
  members: CampaignMember[];
};

const initialState: CampaignActionState = {};

export function CampaignSequencePanel({
  campaignId,
  campaignStatus,
  automationEnabled,
  campaignTimezone,
  steps,
  members,
}: Props) {
  const router = useRouter();
  const [stepType, setStepType] = useState<"manual_followup" | "automated_followup">(
    ["completed", "scheduled"].includes(campaignStatus)
      ? "manual_followup"
      : "automated_followup",
  );
  const [sendMode, setSendMode] = useState<"immediate" | "scheduled">("immediate");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [audience, setAudience] = useState<"all_eligible" | "not_replied" | "custom">(
    "not_replied",
  );
  const [state, formAction, pending] = useActionState(saveFollowupAction, initialState);
  const [message, setMessage] = useState<CampaignActionState | null>(null);
  const [busy, startTransition] = useTransition();
  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || campaignTimezone || "UTC";

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  function run(action: () => Promise<CampaignActionState>) {
    startTransition(async () => {
      const result = await action();
      setMessage(result);
      router.refresh();
    });
  }

  const canCreateManual = ["completed", "scheduled"].includes(campaignStatus);

  return (
    <div className="space-y-6">
      {(state.error || state.success) ? (
        <Alert variant={state.error ? "error" : "success"}>{state.error ?? state.success}</Alert>
      ) : null}
      {(message?.error || message?.success) ? (
        <Alert variant={message.error ? "error" : "success"}>
          {message.error ?? message.success}
        </Alert>
      ) : null}

      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-slate-900">
              <Bot className="h-4 w-4 text-indigo-600" />
              Automated follow-ups
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Steps are never created automatically. Enable automation only when this
              campaign should advance contacts through the steps below.
            </p>
          </div>
          <Button
            variant={automationEnabled ? "secondary" : "primary"}
            disabled={busy}
            onClick={() =>
              run(() => setCampaignAutomationAction(campaignId, !automationEnabled))
            }
          >
            {automationEnabled ? "Disable automation" : "Enable automation"}
          </Button>
        </div>
      </div>

      <section>
        <h3 className="mb-3 font-semibold text-slate-900">Sequence</h3>
        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={step.id} className="relative flex gap-4 rounded-xl border border-slate-200 p-4">
              {index < steps.length - 1 ? (
                <div className="absolute left-7 top-12 h-[calc(100%+12px)] w-px bg-slate-200" />
              ) : null}
              <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                {step.step_number}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-slate-900">
                    {step.step_type === "initial"
                      ? "Initial email"
                      : step.step_type === "manual_followup"
                        ? "Manual follow-up"
                        : "Automated follow-up"}
                  </p>
                  <Badge variant={step.status === "sent" ? "success" : step.status === "cancelled" ? "danger" : "muted"}>
                    {step.status}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-sm text-slate-600">
                  {subjectForDisplay(step.subject)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {step.send_mode === "automated"
                    ? `${Math.round(step.delay_minutes / 1440)} day${step.delay_minutes === 1440 ? "" : "s"} after the previous step`
                    : step.scheduled_at
                      ? `Scheduled ${new Date(step.scheduled_at).toLocaleString()} (${step.timezone})`
                      : "Send immediately"}
                  {" · "}
                  Audience: {step.audience_mode.replaceAll("_", " ")}
                  {" · "}
                  Stop on {[
                    step.stop_on_reply && "reply",
                    step.stop_on_unsubscribe && "unsubscribe",
                    step.stop_on_bounce && "bounce",
                  ].filter(Boolean).join(", ") || "nothing"}
                </p>
              </div>
              {step.step_type !== "initial" && ["draft", "scheduled"].includes(step.status) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(() => cancelFollowupAction(campaignId, step.id))}
                >
                  <XCircle className="h-4 w-4" />
                  Cancel
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <form action={formAction} className="space-y-5 rounded-xl border border-slate-200 p-5">
        <input type="hidden" name="campaignId" value={campaignId} />
        <input type="hidden" name="stepType" value={stepType} />
        <input
          type="hidden"
          name="sendMode"
          value={stepType === "automated_followup" ? "automated" : sendMode}
        />
        <input type="hidden" name="timezone" value={timezone} />
        <input
          type="hidden"
          name="scheduledAt"
          value={scheduledLocal ? new Date(scheduledLocal).toISOString() : ""}
        />
        <div>
          <h3 className="font-semibold text-slate-900">Add a follow-up step</h3>
          <p className="text-sm text-slate-500">
            Replies are manually marked unless your provider reports them.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="step-type">Step type</Label>
            <select
              id="step-type"
              value={stepType}
              onChange={(event) => setStepType(event.target.value as typeof stepType)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="automated_followup">Automated follow-up</option>
              <option value="manual_followup" disabled={!canCreateManual}>
                Manual follow-up {!canCreateManual ? "(available after sent)" : ""}
              </option>
            </select>
          </div>
          <div>
            <Label htmlFor="followup-subject">Subject (optional)</Label>
            <Input id="followup-subject" name="subject" />
          </div>
        </div>

        <div>
          <Label>Message</Label>
          <RichTextEditor name="htmlContent" placeholder="Write the follow-up..." />
        </div>
        <div>
          <Label htmlFor="followup-text">Plain text (optional)</Label>
          <Textarea id="followup-text" name="textContent" rows={4} />
        </div>

        {stepType === "automated_followup" ? (
          <div>
            <Label htmlFor="delay-days">Delay after previous step (days)</Label>
            <Input id="delay-days" name="delayDays" type="number" min={0} max={365} defaultValue={3} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="send-mode">Delivery</Label>
              <select
                id="send-mode"
                value={sendMode}
                onChange={(event) => setSendMode(event.target.value as typeof sendMode)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="immediate">Send now</option>
                <option value="scheduled">Schedule</option>
              </select>
            </div>
            {sendMode === "scheduled" ? (
              <div>
                <Label htmlFor="scheduled-at">Date and time ({timezone})</Label>
                <Input
                  id="scheduled-at"
                  type="datetime-local"
                  required
                  value={scheduledLocal}
                  onChange={(event) => setScheduledLocal(event.target.value)}
                />
              </div>
            ) : null}
          </div>
        )}

        <div>
          <Label htmlFor="audience-mode">Audience</Label>
          <select
            id="audience-mode"
            name="audienceMode"
            value={audience}
            onChange={(event) => setAudience(event.target.value as typeof audience)}
            className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="all_eligible">All eligible enrolled contacts</option>
            <option value="not_replied">Enrolled contacts not marked replied</option>
            <option value="custom">Custom selection</option>
          </select>
        </div>
        {audience === "custom" ? (
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {members.map((member) => (
              <label key={member.contactId} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" name="contactIds" value={member.contactId} />
                <span>{contactDisplayName(member.firstName, member.lastName)}</span>
                <span className="truncate text-slate-500">{member.email}</span>
              </label>
            ))}
          </div>
        ) : null}

        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-2 text-sm font-medium text-slate-700">Stop conditions</legend>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="stopOnReply" defaultChecked />
            Reply
          </label>
          <input type="hidden" name="stopOnUnsubscribe" value="on" />
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input type="checkbox" checked disabled readOnly />
            Unsubscribe (always enforced)
          </label>
          <input type="hidden" name="stopOnBounce" value="on" />
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input type="checkbox" checked disabled readOnly />
            Bounce (when reported)
          </label>
        </fieldset>

        <Button type="submit" disabled={pending || (stepType === "manual_followup" && !canCreateManual)}>
          {stepType === "automated_followup" ? <Clock3 className="h-4 w-4" /> : sendMode === "scheduled" ? <CalendarClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          {pending
            ? "Saving..."
            : stepType === "automated_followup"
              ? "Add automated step"
              : sendMode === "scheduled"
                ? "Schedule follow-up"
                : "Send follow-up now"}
        </Button>
      </form>
    </div>
  );
}
