import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];
export type RecipientRow = Database["public"]["Tables"]["campaign_recipients"]["Row"];

export type CampaignStep = {
  id: string;
  campaign_id: string;
  step_type: "initial" | "manual_followup" | "automated_followup";
  step_number: number;
  subject: string | null;
  html_content: string;
  text_content: string | null;
  delay_minutes: number;
  send_mode: "immediate" | "scheduled" | "automated";
  status: "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  scheduled_at: string | null;
  timezone: string;
  audience_mode: "all_eligible" | "not_replied" | "custom";
  email_account_id: string | null;
  stop_on_reply: boolean;
  stop_on_unsubscribe: boolean;
  stop_on_bounce: boolean;
  target_contact_ids: string[];
  created_at: string;
};

export type CampaignMember = {
  membershipId: string;
  contactId: string;
  firstName: string;
  lastName: string;
  email: string;
  isUnsubscribed: boolean;
  isSuppressed: boolean;
  recipientId: string | null;
  deliveryStatus: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  replySource: string | null;
  sequenceStoppedAt: string | null;
  sequenceStopReason: string | null;
};

export type EligibleCampaignContact = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  enrolled: boolean;
};

export type CampaignActivityItem = {
  id: string;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CampaignBatchOption = {
  id: string;
  name: string;
  totalContacts: number;
  status: string;
  linked: boolean;
  campaignBatchId: string | null;
  scheduledAt: string | null;
  contactIds: string[];
};

export type CampaignWorkspaceData = {
  campaign: CampaignRow & { automation_enabled: boolean; timezone: string };
  stats: CampaignStats;
  failures: DeliveryFailure[];
  engagement: EngagementStats;
  members: CampaignMember[];
  eligibleContacts: EligibleCampaignContact[];
  steps: CampaignStep[];
  activity: CampaignActivityItem[];
  replies: number;
  batches: CampaignBatchOption[];
  defaultBatchSize: number;
};

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

export async function getCampaignWorkspace(
  userId: string,
  campaignId: string,
): Promise<CampaignWorkspaceData | null> {
  const supabase = await createClient();
  const base = await getCampaign(userId, campaignId);
  if (!base.campaign) return null;

  const [
    { data: membershipRows },
    { data: contacts },
    { data: steps },
    { data: activity },
    { data: recipientRows },
    { data: contactBatches },
    { data: campaignBatches },
    { data: profile },
    { data: batchMembers },
  ] = await Promise.all([
    supabase
      .from("campaign_contacts")
      .select("id, contact_id, contacts!inner(id, first_name, last_name, email, is_unsubscribed, is_suppressed)")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .is("removed_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("contacts")
      .select("id, first_name, last_name, email")
      .eq("user_id", userId)
      .eq("is_unsubscribed", false)
      .eq("is_suppressed", false)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("campaign_steps")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .order("step_number", { ascending: true }),
    supabase
      .from("campaign_activity")
      .select("id, event_type, metadata, created_at")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("campaign_recipients")
      .select(
        "id, contact_id, status, sent_at, replied_at, reply_source, sequence_stopped_at, sequence_stop_reason, campaign_step_id, created_at",
      )
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("contact_batches")
      .select("id, name, total_contacts, status")
      .eq("user_id", userId)
      .order("batch_number", { ascending: true }),
    supabase
      .from("campaign_batches")
      .select("id, batch_id, status, scheduled_at")
      .eq("campaign_id", campaignId)
      .eq("user_id", userId),
    supabase
      .from("profiles")
      .select("default_batch_size")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("contact_batch_members")
      .select("batch_id, contact_id")
      .eq("user_id", userId),
  ]);

  const recipientsByContact = new Map<string, NonNullable<typeof recipientRows>[number]>();
  for (const recipient of recipientRows ?? []) {
    const current = recipientsByContact.get(recipient.contact_id);
    if (!current || (!current.sent_at && recipient.sent_at)) {
      recipientsByContact.set(recipient.contact_id, recipient);
    }
  }
  const enrolledIds = new Set((membershipRows ?? []).map((row) => row.contact_id));
  const campaignBatchByBatch = new Map(
    (campaignBatches ?? []).map((link) => [link.batch_id, link]),
  );
  const contactsByBatch = new Map<string, string[]>();
  for (const member of batchMembers ?? []) {
    contactsByBatch.set(member.batch_id, [
      ...(contactsByBatch.get(member.batch_id) ?? []),
      member.contact_id,
    ]);
  }
  const members: CampaignMember[] = (membershipRows ?? []).flatMap((row) => {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
    if (!contact) return [];
    const recipient = recipientsByContact.get(row.contact_id);
    return [{
      membershipId: row.id,
      contactId: row.contact_id,
      firstName: contact.first_name,
      lastName: contact.last_name,
      email: contact.email,
      isUnsubscribed: contact.is_unsubscribed,
      isSuppressed: contact.is_suppressed,
      recipientId: recipient?.id ?? null,
      deliveryStatus: recipient?.status ?? null,
      sentAt: recipient?.sent_at ?? null,
      repliedAt: recipient?.replied_at ?? null,
      replySource: recipient?.reply_source ?? null,
      sequenceStoppedAt: recipient?.sequence_stopped_at ?? null,
      sequenceStopReason: recipient?.sequence_stop_reason ?? null,
    }];
  });

  return {
    campaign: base.campaign as CampaignWorkspaceData["campaign"],
    stats: base.stats,
    failures: base.failures,
    engagement: base.engagement,
    members,
    eligibleContacts: (contacts ?? []).map((contact) => ({
      ...contact,
      enrolled: enrolledIds.has(contact.id),
    })),
    steps: (steps ?? []) as CampaignStep[],
    activity: (activity ?? []).map((item) => ({
      id: item.id,
      eventType: item.event_type,
      metadata:
        item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
          ? item.metadata as Record<string, unknown>
          : {},
      createdAt: item.created_at,
    })),
    replies: new Set(
      (recipientRows ?? [])
        .filter((recipient) => recipient.replied_at)
        .map((recipient) => recipient.contact_id),
    ).size,
    batches: (contactBatches ?? []).map((batch) => {
      const link = campaignBatchByBatch.get(batch.id);
      return {
        id: batch.id,
        name: batch.name,
        totalContacts: batch.total_contacts,
        status: link?.status ?? batch.status,
        linked: Boolean(link),
        campaignBatchId: link?.id ?? null,
        scheduledAt: link?.scheduled_at ?? null,
        contactIds: contactsByBatch.get(batch.id) ?? [],
      };
    }),
    defaultBatchSize: profile?.default_batch_size ?? 50,
  };
}
