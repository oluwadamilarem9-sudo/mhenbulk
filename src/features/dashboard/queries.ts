import { createClient } from "@/lib/supabase/server";

export type DashboardMetrics = {
  totalContacts: number;
  totalCampaigns: number;
  emailsSent: number;
  successfulEmails: number;
  failedEmails: number;
};

const emptyMetrics: DashboardMetrics = {
  totalContacts: 0,
  totalCampaigns: 0,
  emailsSent: 0,
  successfulEmails: 0,
  failedEmails: 0,
};

export async function getDashboardMetrics(userId: string): Promise<{
  metrics: DashboardMetrics;
  error?: string;
}> {
  const supabase = await createClient();

  const [
    contactsResult,
    campaignsResult,
    sentResult,
    successfulResult,
    failedResult,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("campaigns")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("sent_at", "is", null),
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "sent"),
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["failed", "bounced"]),
  ]);

  const firstError =
    contactsResult.error ||
    campaignsResult.error ||
    sentResult.error ||
    successfulResult.error ||
    failedResult.error;

  if (firstError) {
    // Tables may not exist yet before migrations are applied.
    return {
      metrics: emptyMetrics,
      error:
        firstError.code === "42P01" || firstError.message.includes("does not exist")
          ? "Database tables are not available yet. Apply the Supabase migration, then refresh."
          : "Unable to load dashboard metrics right now.",
    };
  }

  return {
    metrics: {
      totalContacts: contactsResult.count ?? 0,
      totalCampaigns: campaignsResult.count ?? 0,
      emailsSent: sentResult.count ?? 0,
      successfulEmails: successfulResult.count ?? 0,
      failedEmails: failedResult.count ?? 0,
    },
  };
}
