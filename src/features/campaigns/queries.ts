import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];
export type RecipientRow = Database["public"]["Tables"]["campaign_recipients"]["Row"];

export type CampaignStats = {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
};

export async function listCampaigns(userId: string): Promise<{
  campaigns: CampaignRow[];
  error?: string;
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { campaigns: [], error: "Unable to load campaigns right now." };
  }

  return { campaigns: data ?? [] };
}

export type DeliveryFailure = {
  email: string;
  error: string;
};

export type EngagementStats = {
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
};

export async function getCampaign(
  userId: string,
  campaignId: string,
): Promise<{
  campaign: CampaignRow | null;
  stats: CampaignStats;
  failures: DeliveryFailure[];
  engagement: EngagementStats;
}> {
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .maybeSingle();

  const emptyStats: CampaignStats = { total: 0, sent: 0, failed: 0, skipped: 0, pending: 0 };
  const emptyEngagement: EngagementStats = {
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
  };

  if (!campaign) {
    return {
      campaign: null,
      stats: emptyStats,
      failures: [],
      engagement: emptyEngagement,
    };
  }

  const { data: recipients } = await supabase
    .from("campaign_recipients")
    .select("status")
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId);

  const stats = { ...emptyStats };

  for (const recipient of recipients ?? []) {
    stats.total++;
    if (recipient.status === "sent") stats.sent++;
    else if (recipient.status === "failed" || recipient.status === "bounced") stats.failed++;
    else if (recipient.status === "skipped") stats.skipped++;
    else stats.pending++;
  }

  const { data: failedRows } = await supabase
    .from("campaign_recipients")
    .select("email, last_error")
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId)
    .in("status", ["failed", "bounced", "skipped"])
    .not("last_error", "is", null)
    .order("updated_at", { ascending: false })
    .limit(5);

  const failures: DeliveryFailure[] = (failedRows ?? []).map((row) => ({
    email: row.email,
    error: row.last_error ?? "Unknown error",
  }));

  // Count unique recipients per webhook event type (opens/clicks can repeat).
  const { data: eventRows } = await supabase
    .from("email_events")
    .select("event_type, campaign_recipient_id")
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId)
    .in("event_type", ["delivered", "opened", "clicked", "bounced", "complained"]);

  const engagement = { ...emptyEngagement };
  const seenByType = new Map<string, Set<string>>();

  for (const row of eventRows ?? []) {
    const key = row.event_type;
    const recipientId = row.campaign_recipient_id ?? "unknown";
    const seen = seenByType.get(key) ?? new Set<string>();
    if (!seen.has(recipientId)) {
      seen.add(recipientId);
      seenByType.set(key, seen);
      if (key in engagement) {
        engagement[key as keyof EngagementStats]++;
      }
    }
  }

  return { campaign, stats, failures, engagement };
}

export async function countEligibleContacts(userId: string): Promise<number> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_unsubscribed", false)
    .eq("is_suppressed", false);

  return count ?? 0;
}
