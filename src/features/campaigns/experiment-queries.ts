import type { SupabaseClient } from "@supabase/supabase-js";

import { compareVariantPerformance, type ExperimentPrimaryMetric, type ExperimentStatus, type VariantPerformance } from "@/features/campaigns/experiment-model";
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
  clickTracking: "available" | "unavailable";
  resultsError?: string;
};

function missingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205";
}

export async function loadCampaignExperiment(
  supabase: SupabaseClient<Database>,
  userId: string,
  campaignId: string,
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

  const [
    { data: variants, error: variantError },
    { data: metrics, error: metricsError },
    { data: campaignRow, error: campaignError },
  ] = await Promise.all([
    supabase
      .from("campaign_experiment_variants")
      .select("id, name, subject, html_content, text_content, allocation_percentage, enabled, position")
      .eq("experiment_id", experiment.id)
      .eq("user_id", userId)
      .order("position", { ascending: true }),
    supabase.rpc("campaign_experiment_metrics", { p_experiment_id: experiment.id }),
    supabase
      .from("campaigns")
      .select("email_account_id")
      .eq("id", campaignId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (variantError || !variants) {
    return { experiment: null, error: "Unable to load A/B variants." };
  }
  if (metricsError || metrics == null) {
    return {
      experiment: {
        id: experiment.id,
        status: experiment.status as ExperimentStatus,
        primaryMetric: experiment.primary_metric as ExperimentPrimaryMetric,
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
        results: [],
        comparison: "",
        clickTracking: "unavailable",
        resultsError: "Unable to calculate A/B results.",
      },
    };
  }
  if (campaignError) {
    return { experiment: null, error: "Unable to load the sending account for this test." };
  }

  let clickTracking: "available" | "unavailable" = "unavailable";
  if (campaignRow?.email_account_id) {
    const { data: account, error: accountError } = await supabase
      .from("email_accounts")
      .select("provider")
      .eq("id", campaignRow.email_account_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (accountError) {
      return { experiment: null, error: "Unable to load the sending account for this test." };
    }
    if (account?.provider === "resend") clickTracking = "available";
  }

  const metric = experiment.primary_metric as ExperimentPrimaryMetric;
  const counts = new Map((metrics ?? []).map((row) => [row.variant_id, row]));
  const results: VariantPerformance[] = variants.map((variant) => {
    const count = counts.get(variant.id);
    const sent = Number(count?.sent ?? 0);
    const opened = Number(count?.opened ?? 0);
    const clicked = Number(count?.clicked ?? 0);
    const replied = Number(count?.replied ?? 0);
    const rateText = (numerator: number) =>
      sent > 0 ? `${((numerator / sent) * 100).toFixed(1)}%` : "—";
    return {
      variantId: variant.id,
      name: variant.name,
      assigned: Number(count?.assigned ?? 0),
      sent,
      failed: Number(count?.failed ?? 0),
      opened,
      clicked,
      replied,
      openRate: rateText(opened),
      clickRate: clickTracking === "unavailable" ? "Not available" : rateText(clicked),
      replyRate: rateText(replied),
    };
  });
  const comparison = compareVariantPerformance(results, metric, { clickTracking });

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
      results,
      comparison: comparison.summary,
      clickTracking,
    },
  };
}
