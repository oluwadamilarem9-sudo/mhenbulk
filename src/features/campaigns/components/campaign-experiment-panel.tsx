"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  completeCampaignExperimentAction,
  pauseCampaignExperimentAction,
  resumeCampaignExperimentAction,
  saveCampaignExperimentAction,
  startCampaignExperimentAction,
} from "@/features/campaigns/experiment-actions";
import { evenSplit, type ExperimentPrimaryMetric } from "@/features/campaigns/experiment-model";
import type { CampaignExperimentView } from "@/features/campaigns/experiment-queries";
import { RichTextEditor } from "@/features/campaigns/components/rich-text-editor";
import type { CampaignActionState } from "@/features/campaigns/schemas";
import { subjectForSend } from "@/features/campaigns/schemas";

const MAX_VARIANTS = 8;

type DraftVariant = {
  key: string;
  id?: string;
  name: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  allocationPercentage: number;
  enabled: boolean;
};

type Props = {
  campaignId: string;
  campaignSubject: string;
  campaignHtml: string;
  experiment: CampaignExperimentView | null;
  loadError?: string;
};

function newKey() {
  return `new-${crypto.randomUUID()}`;
}

function blankVariants(subject: string, html: string): DraftVariant[] {
  const [first, second] = evenSplit(2);
  return [
    {
      key: newKey(),
      name: "Variant A",
      subject: subjectForSend(subject),
      htmlContent: html,
      textContent: "",
      allocationPercentage: first ?? 50,
      enabled: true,
    },
    {
      key: newKey(),
      name: "Variant B",
      subject: "",
      htmlContent: "",
      textContent: "",
      allocationPercentage: second ?? 50,
      enabled: true,
    },
  ];
}

function fromExperiment(experiment: CampaignExperimentView): DraftVariant[] {
  return experiment.variants.map((variant) => ({
    key: variant.id,
    id: variant.id,
    name: variant.name,
    subject: variant.subject,
    htmlContent: variant.htmlContent,
    textContent: variant.textContent,
    allocationPercentage: variant.allocationPercentage,
    enabled: variant.enabled,
  }));
}

export function CampaignExperimentPanel({
  campaignId,
  campaignSubject,
  campaignHtml,
  experiment,
  loadError,
}: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<CampaignActionState | null>(null);
  const [pending, startTransition] = useTransition();
  const [primaryMetric, setPrimaryMetric] = useState<ExperimentPrimaryMetric>(
    experiment?.primaryMetric ?? "opened",
  );
  const [variants, setVariants] = useState<DraftVariant[]>(
    experiment ? fromExperiment(experiment) : blankVariants(campaignSubject, campaignHtml),
  );
  const locked = experiment != null && experiment.status !== "draft";
  const enabledTotal = variants
    .filter((variant) => variant.enabled)
    .reduce((sum, variant) => sum + variant.allocationPercentage, 0);

  function update(key: string, patch: Partial<DraftVariant>) {
    setVariants((current) =>
      current.map((variant) => (variant.key === key ? { ...variant, ...patch } : variant)),
    );
  }

  function payload() {
    return {
      primaryMetric,
      variants: variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        subject: variant.subject,
        htmlContent: variant.htmlContent,
        textContent: variant.textContent,
        allocationPercentage: variant.allocationPercentage,
        enabled: variant.enabled,
      })),
    };
  }

  function run(action: () => Promise<CampaignActionState>) {
    startTransition(async () => {
      const result = await action();
      setMessage(result);
      if (!result.error) router.refresh();
    });
  }

  function splitEvenly() {
    const enabledKeys = variants.filter((variant) => variant.enabled).map((variant) => variant.key);
    const shares = evenSplit(enabledKeys.length);
    setVariants((current) =>
      current.map((variant) => {
        const index = enabledKeys.indexOf(variant.key);
        if (index === -1) return { ...variant, allocationPercentage: 0 };
        return { ...variant, allocationPercentage: shares[index] ?? 0 };
      }),
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>A/B test</CardTitle>
            {experiment ? <Badge variant="info">{experiment.status}</Badge> : <Badge variant="muted">Not saved</Badge>}
          </div>
          <CardDescription>
            Each recipient is assigned one variant for the first email and keeps it on retry.
            Follow-up steps still use the sequence you wrote. Campaigns without a running test
            send the original message.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError ? <Alert variant="error">{loadError}</Alert> : null}
          {message?.error ? <Alert variant="error">{message.error}</Alert> : null}
          {message?.success ? <Alert variant="success">{message.success}</Alert> : null}
          <div className="max-w-xs">
            <Label htmlFor="experiment-metric">Primary metric</Label>
            <select
              id="experiment-metric"
              className="mt-1 flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
              value={primaryMetric}
              disabled={locked || pending}
              onChange={(event) => setPrimaryMetric(event.target.value as ExperimentPrimaryMetric)}
            >
              <option value="opened">Open rate</option>
              <option value="clicked">Click rate</option>
              <option value="replied">Reply rate</option>
            </select>
          </div>
          <p className="text-sm text-slate-500">
            Enabled allocation: {enabledTotal}%. It must equal 100% before the test can start.
          </p>
          {locked ? null : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={pending} onClick={splitEvenly}>
                Split evenly
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || variants.length >= MAX_VARIANTS}
                onClick={() =>
                  setVariants((current) => [
                    ...current,
                    {
                      key: newKey(),
                      name: `Variant ${current.length + 1}`,
                      subject: "",
                      htmlContent: "",
                      textContent: "",
                      allocationPercentage: 0,
                      enabled: true,
                    },
                  ])
                }
              >
                Add variant
              </Button>
              <Button type="button" disabled={pending || Boolean(loadError)} onClick={() => run(() => saveCampaignExperimentAction(campaignId, payload()))}>
                {pending ? "Saving..." : "Save draft"}
              </Button>
              <Button type="button" disabled={pending || Boolean(loadError)} onClick={() => run(() => startCampaignExperimentAction(campaignId, payload()))}>
                Start test
              </Button>
            </div>
          )}
          {experiment?.status === "running" ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => pauseCampaignExperimentAction(campaignId))}>
                Pause test
              </Button>
              <Button type="button" disabled={pending} onClick={() => run(() => completeCampaignExperimentAction(campaignId))}>
                Complete test
              </Button>
            </div>
          ) : null}
          {experiment?.status === "paused" ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending} onClick={() => run(() => resumeCampaignExperimentAction(campaignId))}>
                Resume test
              </Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => completeCampaignExperimentAction(campaignId))}>
                Complete test
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {variants.map((variant, index) => (
        <Card key={variant.key}>
          <CardHeader>
            <CardTitle>{variant.name || `Variant ${index + 1}`}</CardTitle>
            <CardDescription>{variant.enabled ? "Enabled" : "Disabled — not assigned to new recipients"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`${variant.key}-name`}>Name</Label>
                <Input
                  id={`${variant.key}-name`}
                  value={variant.name}
                  disabled={locked || pending}
                  onChange={(event) => update(variant.key, { name: event.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${variant.key}-allocation`}>Allocation %</Label>
                <Input
                  id={`${variant.key}-allocation`}
                  type="number"
                  min={0}
                  max={100}
                  value={variant.allocationPercentage}
                  disabled={locked || pending}
                  onChange={(event) =>
                    update(variant.key, { allocationPercentage: Number(event.target.value) })
                  }
                />
              </div>
            </div>
            <div>
              <Label htmlFor={`${variant.key}-subject`}>Subject</Label>
              <Input
                id={`${variant.key}-subject`}
                value={variant.subject}
                disabled={locked || pending}
                onChange={(event) => update(variant.key, { subject: event.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={variant.enabled}
                disabled={locked || pending}
                onChange={(event) => update(variant.key, { enabled: event.target.checked })}
              />
              Enabled
            </label>
            {locked ? (
              <iframe
                title={`${variant.name} preview`}
                srcDoc={variant.htmlContent}
                sandbox=""
                className="h-48 w-full rounded-lg border border-slate-200"
              />
            ) : (
              <RichTextEditor
                name={`${variant.key}-html`}
                initialValue={variant.htmlContent}
                onHtmlChange={(html) => update(variant.key, { htmlContent: html })}
              />
            )}
            <div>
              <Label htmlFor={`${variant.key}-text`}>Plain-text version</Label>
              <Textarea
                id={`${variant.key}-text`}
                value={variant.textContent}
                disabled={locked || pending}
                onChange={(event) => update(variant.key, { textContent: event.target.value })}
              />
            </div>
            {locked || variants.length <= 2 ? null : (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setVariants((current) => current.filter((item) => item.key !== variant.key))}
              >
                Remove variant
              </Button>
            )}
          </CardContent>
        </Card>
      ))}

      {experiment && experiment.status !== "draft" ? (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>{experiment.comparison}</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Variant</th>
                  <th className="py-2 pr-3 font-medium">Assigned</th>
                  <th className="py-2 pr-3 font-medium">Sent</th>
                  <th className="py-2 pr-3 font-medium">Failed</th>
                  <th className="py-2 pr-3 font-medium">Opened</th>
                  <th className="py-2 pr-3 font-medium">Open rate</th>
                  <th className="py-2 pr-3 font-medium">Clicked</th>
                  <th className="py-2 pr-3 font-medium">Click rate</th>
                  <th className="py-2 pr-3 font-medium">Replies</th>
                  <th className="py-2 font-medium">Reply rate</th>
                </tr>
              </thead>
              <tbody>
                {experiment.results.map((row) => (
                  <tr key={row.variantId} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-900">{row.name}</td>
                    <td className="py-2 pr-3">{row.assigned}</td>
                    <td className="py-2 pr-3">{row.sent}</td>
                    <td className="py-2 pr-3">{row.failed}</td>
                    <td className="py-2 pr-3">{row.opened}</td>
                    <td className="py-2 pr-3">{row.openRate}</td>
                    <td className="py-2 pr-3">{row.clicked}</td>
                    <td className="py-2 pr-3">{row.clickRate}</td>
                    <td className="py-2 pr-3">{row.replied}</td>
                    <td className="py-2">{row.replyRate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
