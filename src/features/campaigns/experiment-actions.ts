"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  canManageCampaignExperiment,
  nextExperimentStatus,
  validateExperimentSetup,
  type ExperimentPrimaryMetric,
  type ExperimentStatus,
  type ExperimentVariantInput,
} from "@/features/campaigns/experiment-model";
import type { CampaignActionState } from "@/features/campaigns/schemas";
import { createClient } from "@/lib/supabase/server";

const variantSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Each variant needs a name.").max(80),
  subject: z.string().trim().min(1).max(300),
  htmlContent: z.string().trim().min(1).max(200_000),
  textContent: z.string().trim().max(100_000).optional().or(z.literal("")),
  allocationPercentage: z.number().int().min(0).max(100),
  enabled: z.boolean(),
});

const experimentInputSchema = z.object({
  primaryMetric: z.enum(["opened", "clicked", "replied"]),
  variants: z.array(variantSchema).min(2).max(8),
});

type ExperimentInput = z.infer<typeof experimentInputSchema>;

type OwnedCampaign = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  campaignId: string;
  campaignStatus: string;
};

async function requireOwnedCampaign(campaignId: string): Promise<{ ok: false; error: string } | OwnedCampaign> {
  const parsedId = z.string().uuid().safeParse(campaignId);
  if (!parsedId.success) return { ok: false, error: "Invalid campaign." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, user_id, status")
    .eq("id", parsedId.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!campaign || !canManageCampaignExperiment(user.id, campaign.user_id)) {
    return { ok: false, error: "Campaign not found." };
  }
  return {
    ok: true,
    supabase,
    userId: user.id,
    campaignId: campaign.id,
    campaignStatus: campaign.status,
  };
}

function toVariantInputs(input: ExperimentInput): ExperimentVariantInput[] {
  return input.variants.map((variant, position) => ({
    id: variant.id ?? `new-${position}`,
    name: variant.name,
    subject: variant.subject,
    htmlContent: variant.htmlContent,
    textContent: variant.textContent ?? "",
    allocationPercentage: variant.allocationPercentage,
    enabled: variant.enabled,
    position,
  }));
}

async function persistDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  campaignId: string,
  input: ExperimentInput,
) {
  const setup = validateExperimentSetup(toVariantInputs(input));
  if (!setup.ok) return { error: setup.error };

  const { data: existing, error: loadError } = await supabase
    .from("campaign_experiments")
    .select("id, status")
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .maybeSingle();
  if (loadError) return { error: "Unable to load the A/B test." };
  if (existing && existing.status !== "draft") {
    return { error: "Variants can only be edited while the test is a draft." };
  }

  let experimentId = existing?.id;
  if (!experimentId) {
    const { data: created, error: createError } = await supabase
      .from("campaign_experiments")
      .insert({
        user_id: userId,
        campaign_id: campaignId,
        status: "draft",
        primary_metric: input.primaryMetric,
      })
      .select("id")
      .single();
    if (createError || !created) return { error: "Unable to create the A/B test." };
    experimentId = created.id;
  } else {
    const { error: updateError } = await supabase
      .from("campaign_experiments")
      .update({ primary_metric: input.primaryMetric })
      .eq("id", experimentId)
      .eq("user_id", userId);
    if (updateError) return { error: "Unable to update the A/B test." };
  }

  const { data: currentVariants, error: variantLoadError } = await supabase
    .from("campaign_experiment_variants")
    .select("id")
    .eq("experiment_id", experimentId)
    .eq("user_id", userId);
  if (variantLoadError) return { error: "Unable to load variants." };

  const kept = new Set(input.variants.flatMap((variant) => (variant.id ? [variant.id] : [])));
  const removeIds = (currentVariants ?? []).map((variant) => variant.id).filter((id) => !kept.has(id));
  if (removeIds.length) {
    const { error: deleteError } = await supabase
      .from("campaign_experiment_variants")
      .delete()
      .in("id", removeIds)
      .eq("user_id", userId);
    if (deleteError) return { error: "Unable to remove a variant." };
  }

  for (const [position, variant] of input.variants.entries()) {
    const payload = {
      user_id: userId,
      experiment_id: experimentId,
      name: variant.name.trim(),
      subject: variant.subject.trim(),
      html_content: variant.htmlContent,
      text_content: variant.textContent?.trim() || null,
      allocation_percentage: variant.allocationPercentage,
      enabled: variant.enabled,
      position,
    };
    const existingId = currentVariants?.some((row) => row.id === variant.id) ? variant.id : undefined;
    if (existingId) {
      const { error: updateError } = await supabase
        .from("campaign_experiment_variants")
        .update(payload)
        .eq("id", existingId)
        .eq("user_id", userId);
      if (updateError) return { error: "Unable to update a variant." };
    } else {
      const { error: insertError } = await supabase
        .from("campaign_experiment_variants")
        .insert(payload);
      if (insertError) return { error: "Unable to add a variant." };
    }
  }

  return { experimentId };
}

export async function saveCampaignExperimentAction(
  campaignId: string,
  rawInput: unknown,
): Promise<CampaignActionState> {
  const owned = await requireOwnedCampaign(campaignId);
  if (!owned.ok) return { error: owned.error };
  const parsed = experimentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the variant fields and try again." };
  }
  const saved = await persistDraft(owned.supabase, owned.userId, owned.campaignId, parsed.data);
  if ("error" in saved) return { error: saved.error };
  revalidatePath(`/campaigns/${owned.campaignId}`);
  return { success: "A/B test saved." };
}

export async function startCampaignExperimentAction(
  campaignId: string,
  rawInput: unknown,
): Promise<CampaignActionState> {
  const owned = await requireOwnedCampaign(campaignId);
  if (!owned.ok) return { error: owned.error };
  if (["cancelled", "failed", "completed"].includes(owned.campaignStatus)) {
    return { error: "This campaign cannot start an A/B test." };
  }
  const parsed = experimentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the variant fields and try again." };
  }
  const saved = await persistDraft(owned.supabase, owned.userId, owned.campaignId, parsed.data);
  if ("error" in saved) return saved;
  const { data: experiment } = await owned.supabase
    .from("campaign_experiments")
    .select("status")
    .eq("id", saved.experimentId)
    .eq("user_id", owned.userId)
    .maybeSingle();
  const next = nextExperimentStatus((experiment?.status ?? "draft") as ExperimentStatus, "start");
  if (!next) return { error: "This A/B test cannot be started." };
  const { error } = await owned.supabase
    .from("campaign_experiments")
    .update({ status: next, started_at: new Date().toISOString(), paused_at: null })
    .eq("id", saved.experimentId)
    .eq("user_id", owned.userId);
  if (error) return { error: "Unable to start the A/B test." };
  await owned.supabase.from("campaign_activity").insert({
    user_id: owned.userId,
    campaign_id: owned.campaignId,
    event_type: "experiment_started",
    metadata: { primary_metric: parsed.data.primaryMetric satisfies ExperimentPrimaryMetric },
  });
  revalidatePath(`/campaigns/${owned.campaignId}`);
  return { success: "A/B test started. New sends of the first email use the assigned variant." };
}

async function transitionExperiment(
  campaignId: string,
  action: "pause" | "resume" | "complete",
  success: string,
): Promise<CampaignActionState> {
  const owned = await requireOwnedCampaign(campaignId);
  if (!owned.ok) return { error: owned.error };
  const { data: experiment } = await owned.supabase
    .from("campaign_experiments")
    .select("id, status")
    .eq("campaign_id", owned.campaignId)
    .eq("user_id", owned.userId)
    .maybeSingle();
  if (!experiment) return { error: "This campaign has no A/B test." };
  const next = nextExperimentStatus(experiment.status as ExperimentStatus, action);
  if (!next) return { error: "That action is not available for the current test." };
  const stamp =
    action === "pause"
      ? { paused_at: new Date().toISOString() }
      : action === "complete"
        ? { completed_at: new Date().toISOString() }
        : { paused_at: null };
  const { error } = await owned.supabase
    .from("campaign_experiments")
    .update({ status: next, ...stamp })
    .eq("id", experiment.id)
    .eq("user_id", owned.userId);
  if (error) return { error: "Unable to update the A/B test." };
  await owned.supabase.from("campaign_activity").insert({
    user_id: owned.userId,
    campaign_id: owned.campaignId,
    event_type: `experiment_${action}`,
    metadata: {},
  });
  revalidatePath(`/campaigns/${owned.campaignId}`);
  return { success };
}

export async function pauseCampaignExperimentAction(campaignId: string) {
  return transitionExperiment(campaignId, "pause", "A/B test paused. Assigned recipients keep their variant on retry.");
}

export async function resumeCampaignExperimentAction(campaignId: string) {
  return transitionExperiment(campaignId, "resume", "A/B test resumed.");
}

export async function completeCampaignExperimentAction(campaignId: string) {
  return transitionExperiment(campaignId, "complete", "A/B test completed. Results stay available.");
}
