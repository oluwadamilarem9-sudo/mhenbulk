import type { SupabaseClient } from "@supabase/supabase-js";

import { variantForRecipient } from "@/features/campaigns/experiment-assign";
import { rememberAssignment, validateExperimentSetup, type ExperimentVariantInput } from "@/features/campaigns/experiment-model";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type ExperimentSendDecision =
  | { action: "campaign" }
  | {
      action: "send";
      variant: {
        id: string;
        subject: string;
        html_content: string;
        text_content: string | null;
      };
    }
  | { action: "wait"; reason: string }
  | { action: "fail"; reason: string };

function missingExperimentTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (error.message ?? "").includes("campaign_experiments")
  );
}

/**
 * Resolves the first-email copy for one recipient.
 * Follow-ups and campaigns without a running test keep the saved campaign message.
 * An existing assignment is reused on retry even if the test is paused.
 */
export async function resolveInitialExperimentMessage(
  supabase: Client,
  input: {
    userId: string;
    campaignId: string;
    recipientId: string;
    stepType: string;
  },
): Promise<ExperimentSendDecision> {
  if (input.stepType !== "initial") return { action: "campaign" };

  const { data: experiment, error } = await supabase
    .from("campaign_experiments")
    .select("id, status")
    .eq("campaign_id", input.campaignId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    if (missingExperimentTable(error)) return { action: "campaign" };
    return { action: "fail", reason: "Could not load the A/B test for this campaign." };
  }
  if (!experiment || experiment.status === "draft") return { action: "campaign" };

  const { data: assignment, error: assignmentError } = await supabase
    .from("campaign_experiment_assignments")
    .select("variant_id")
    .eq("experiment_id", experiment.id)
    .eq("campaign_recipient_id", input.recipientId)
    .maybeSingle();

  if (assignmentError) {
    return { action: "fail", reason: "Could not load this recipient's A/B assignment." };
  }

  const { data: variantRows, error: variantError } = await supabase
    .from("campaign_experiment_variants")
    .select("id, name, subject, html_content, text_content, allocation_percentage, enabled, position")
    .eq("experiment_id", experiment.id)
    .order("position", { ascending: true });

  if (variantError || !variantRows) {
    return { action: "fail", reason: "Could not load A/B variants." };
  }

  if (assignment) {
    const stored = variantRows.find((variant) => variant.id === assignment.variant_id);
    if (!stored) {
      return { action: "fail", reason: "The assigned A/B variant is missing." };
    }
    return {
      action: "send",
      variant: {
        id: stored.id,
        subject: stored.subject,
        html_content: stored.html_content,
        text_content: stored.text_content,
      },
    };
  }

  if (experiment.status === "paused") {
    return {
      action: "wait",
      reason: "A/B test is paused. This recipient waits until the test resumes.",
    };
  }
  if (experiment.status === "completed") {
    return { action: "campaign" };
  }

  const variants: ExperimentVariantInput[] = variantRows.map((variant) => ({
    id: variant.id,
    name: variant.name,
    subject: variant.subject,
    htmlContent: variant.html_content,
    textContent: variant.text_content ?? "",
    allocationPercentage: variant.allocation_percentage,
    enabled: variant.enabled,
    position: variant.position,
  }));
  const setup = validateExperimentSetup(variants);
  if (!setup.ok) {
    return { action: "fail", reason: setup.error };
  }
  const proposed = variantForRecipient(experiment.id, input.recipientId, variants);
  if (!proposed) {
    return { action: "fail", reason: "A/B test has no valid variant allocation." };
  }

  const { error: insertError } = await supabase.from("campaign_experiment_assignments").insert({
    user_id: input.userId,
    experiment_id: experiment.id,
    campaign_recipient_id: input.recipientId,
    variant_id: proposed.id,
  });

  if (!insertError) {
    const row = variantRows.find((variant) => variant.id === proposed.id);
    if (!row) return { action: "fail", reason: "The assigned A/B variant is missing." };
    return {
      action: "send",
      variant: {
        id: row.id,
        subject: row.subject,
        html_content: row.html_content,
        text_content: row.text_content,
      },
    };
  }

  if (insertError.code !== "23505") {
    return { action: "fail", reason: "Could not save the A/B assignment." };
  }

  const { data: winner } = await supabase
    .from("campaign_experiment_assignments")
    .select("variant_id")
    .eq("experiment_id", experiment.id)
    .eq("campaign_recipient_id", input.recipientId)
    .maybeSingle();
  const kept = rememberAssignment(winner?.variant_id, proposed.id);
  const row = variantRows.find((variant) => variant.id === kept.variantId);
  if (!row) return { action: "fail", reason: "The assigned A/B variant is missing." };
  return {
    action: "send",
    variant: {
      id: row.id,
      subject: row.subject,
      html_content: row.html_content,
      text_content: row.text_content,
    },
  };
}
