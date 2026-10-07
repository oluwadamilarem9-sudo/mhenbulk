import type { SupabaseClient } from "@supabase/supabase-js";

import { aggregateVariantPerformance, type ExperimentPrimaryMetric, type ExperimentStatus, type VariantPerformance } from "@/features/campaigns/experiment-model";
import type { Database } from "@/lib/supabase/database.types";

export type CampaignExperimentVariantView = {
  id: string;
  name: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  allocationPercentage: number;
  enabled: boolean;
  position: number;
};

export type CampaignExperimentView = {
  id: string;
  status: ExperimentStatus;
  primaryMetric: ExperimentPrimaryMetric;
  variants: CampaignExperimentVariantView[];
  results: VariantPerformance[];
  comparison: string;
};

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205";
}

export async function loadCampaignExperiment(
  supabase: SupabaseClient<Database>,
  userId: string,
  campaignId: string,
  recipients: Array<{ id: string; status: string; replied_at: string | null }>,
): Promise<{ experiment: CampaignExperimentView | null; error?: string }> {
  const { data: experiment, error } = await supabase
    .from("campaign_experiments")
    .select("id, status, primary_metric")
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (missingTable(error)) {
      return { experiment: null, error: "A/B testing is not available until the latest database migration is applied." };
    }
    return { experiment: null, error: "Unable to load the A/B test." };
  }
  if (!experiment) return { experiment: null };

  const [{ data: variants, error: variantError }, { data: assignments }, { data: events }] = await Promise.all([
    supabase
      .from("campaign_experiment_variants")
      .select("id, name, subject, html_content, text_content, allocation_percentage, enabled, position")
      .eq("experiment_id", experiment.id)
      .eq("user_id", userId)
      .order("position", { ascending: true }),
    supabase
      .from("campaign_experiment_assignments")
      .select("campaign_recipient_id, variant_id")
      .eq("experiment_id", experiment.id)
      .eq("user_id", userId)
      .limit(10000),
    supabase
      .from("email_events")
      .select("campaign_recipient_id, event_type")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .in("event_type", ["opened", "clicked"])
      .limit(10000),
  ]);

  if (variantError || !variants) {
    return { experiment: null, error: "Unable to load A/B variants." };
  }

  const metric = experiment.primary_metric as ExperimentPrimaryMetric;
  const aggregated = aggregateVariantPerformance({
    variants: variants.map((variant) => ({ id: variant.id, name: variant.name })),
    assignments: (assignments ?? []).flatMap((row) =>
      row.campaign_recipient_id
        ? [{ recipientId: row.campaign_recipient_id, variantId: row.variant_id }]
        : [],
    ),
    recipients: recipients.map((recipient) => ({
      id: recipient.id,
      status: recipient.status,
      replied: Boolean(recipient.replied_at),
    })),
    events: (events ?? []).flatMap((event) =>
      event.campaign_recipient_id
        ? [{ recipientId: event.campaign_recipient_id, type: event.event_type }]
        : [],
    ),
    primaryMetric: metric,
  });

  return {
    experiment: {
      id: experiment.id,
      status: experiment.status as ExperimentStatus,
      primaryMetric: metric,
      variants: variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        subject: variant.subject,
        htmlContent: variant.html_content,
        textContent: variant.text_content ?? "",
        allocationPercentage: variant.allocation_percentage,
        enabled: variant.enabled,
        position: variant.position,
      })),
      results: aggregated.rows,
      comparison: aggregated.comparison.summary,
    },
  };
}
