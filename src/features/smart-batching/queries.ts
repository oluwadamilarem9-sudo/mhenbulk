import { createClient } from "@/lib/supabase/server";
import type {
  ContactBatchStatus,
  Database,
} from "@/lib/supabase/database.types";

type ContactBatchRow = Database["public"]["Tables"]["contact_batches"]["Row"];

export type SmartBatchCampaign = {
  id: string;
  campaignId: string;
  campaignName: string;
  status: ContactBatchStatus;
  scheduledAt: string | null;
  timezone: string;
  providerError: string | null;
  progress: {
    total: number;
    sent: number;
    pending: number;
    failed: number;
    skipped: number;
    replied: number;
    percent: number;
  };
};

export type SmartBatchSummary = ContactBatchRow & {
  campaigns: SmartBatchCampaign[];
};

export type SmartBatchContact = {
  membershipId: string;
  position: number;
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string | null;
  status: "active" | "unsubscribed" | "bounced" | "invalid";
  isUnsubscribed: boolean;
  isSuppressed: boolean;
};

export type SmartBatchDetail = {
  batch: SmartBatchSummary;
  contacts: SmartBatchContact[];
  counts: {
    total: number;
    active: number;
    unsubscribed: number;
    bounced: number;
    invalid: number;
  };
};

export type BatchCampaignOption = {
  id: string;
  name: string;
};

export async function getSmartBatchingWorkspace(userId: string): Promise<{
  batches: SmartBatchSummary[];
  defaultBatchSize: number;
  campaigns: BatchCampaignOption[];
  error?: string;
}> {
  const supabase = await createClient();
  const [batchesResult, linksResult, campaignsResult, profileResult, recipientsResult] =
    await Promise.all([
      supabase
        .from("contact_batches")
        .select("*")
        .eq("user_id", userId)
        .order("batch_number", { ascending: false }),
      supabase
        .from("campaign_batches")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("campaigns")
        .select("id, name, status")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("default_batch_size")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("campaign_recipients")
        .select("campaign_batch_id, status, replied_at")
        .eq("user_id", userId)
        .not("campaign_batch_id", "is", null),
    ]);

  if (batchesResult.error) {
    return {
      batches: [],
      defaultBatchSize: profileResult.data?.default_batch_size ?? 50,
      campaigns: [],
      error:
        batchesResult.error.code === "42P01" ||
        batchesResult.error.code === "PGRST205"
          ? "Smart Batching requires Supabase migration 0008."
          : "Unable to load Smart Batches.",
    };
  }

  const campaignNames = new Map(
    (campaignsResult.data ?? []).map((campaign) => [campaign.id, campaign.name]),
  );
  const linksByBatch = new Map<string, SmartBatchCampaign[]>();
  const progressByLink = new Map<
    string,
    SmartBatchCampaign["progress"]
  >();
  for (const recipient of recipientsResult.data ?? []) {
    if (!recipient.campaign_batch_id) continue;
    const progress = progressByLink.get(recipient.campaign_batch_id) ?? {
      total: 0,
      sent: 0,
      pending: 0,
      failed: 0,
      skipped: 0,
      replied: 0,
      percent: 0,
    };
    progress.total++;
    if (recipient.status === "sent") progress.sent++;
    else if (recipient.status === "failed" || recipient.status === "bounced") {
      progress.failed++;
    } else if (recipient.status === "skipped") progress.skipped++;
    else progress.pending++;
    if (recipient.replied_at) progress.replied++;
    progress.percent =
      progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;
    progressByLink.set(recipient.campaign_batch_id, progress);
  }
  for (const link of linksResult.data ?? []) {
    linksByBatch.set(link.batch_id, [
      ...(linksByBatch.get(link.batch_id) ?? []),
      {
        id: link.id,
        campaignId: link.campaign_id,
        campaignName: campaignNames.get(link.campaign_id) ?? "Campaign",
        status: link.status,
        scheduledAt: link.scheduled_at,
        timezone: link.timezone,
        providerError: link.provider_error,
        progress: progressByLink.get(link.id) ?? {
          total: 0,
          sent: 0,
          pending: 0,
          failed: 0,
          skipped: 0,
          replied: 0,
          percent: 0,
        },
      },
    ]);
  }

  return {
    batches: (batchesResult.data ?? []).map((batch) => ({
      ...batch,
      campaigns: linksByBatch.get(batch.id) ?? [],
    })),
    defaultBatchSize: profileResult.data?.default_batch_size ?? 50,
    campaigns: (campaignsResult.data ?? [])
      .filter((campaign) => campaign.status === "draft")
      .map((campaign) => ({ id: campaign.id, name: campaign.name })),
  };
}

export async function getSmartBatchDetail(
  userId: string,
  batchId: string,
): Promise<SmartBatchDetail | null> {
  const supabase = await createClient();
  const [
    { data: batch },
    { data: members },
    { data: links },
    { data: campaigns },
    { data: recipients },
  ] =
    await Promise.all([
      supabase
        .from("contact_batches")
        .select("*")
        .eq("id", batchId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("contact_batch_members")
        .select(
          "id, position, contacts!inner(id, first_name, last_name, email, company, status, is_unsubscribed, is_suppressed)",
        )
        .eq("batch_id", batchId)
        .eq("user_id", userId)
        .order("position", { ascending: true }),
      supabase
        .from("campaign_batches")
        .select("*")
        .eq("batch_id", batchId)
        .eq("user_id", userId),
      supabase
        .from("campaigns")
        .select("id, name")
        .eq("user_id", userId),
      supabase
        .from("campaign_recipients")
        .select("campaign_batch_id, status, replied_at")
        .eq("batch_id", batchId)
        .eq("user_id", userId)
        .not("campaign_batch_id", "is", null),
    ]);

  if (!batch) return null;

  const names = new Map((campaigns ?? []).map((campaign) => [campaign.id, campaign.name]));
  const contacts: SmartBatchContact[] = (members ?? []).flatMap((membership) => {
    const contact = Array.isArray(membership.contacts)
      ? membership.contacts[0]
      : membership.contacts;
    if (!contact) return [];
    return [
      {
        membershipId: membership.id,
        position: membership.position,
        id: contact.id,
        firstName: contact.first_name,
        lastName: contact.last_name,
        email: contact.email,
        company: contact.company,
        status: contact.status,
        isUnsubscribed: contact.is_unsubscribed,
        isSuppressed: contact.is_suppressed,
      },
    ];
  });

  const counts = {
    total: contacts.length,
    active: contacts.filter(
      (contact) =>
        contact.status === "active" &&
        !contact.isUnsubscribed &&
        !contact.isSuppressed,
    ).length,
    unsubscribed: contacts.filter(
      (contact) =>
        contact.status === "unsubscribed" || contact.isUnsubscribed,
    ).length,
    bounced: contacts.filter((contact) => contact.status === "bounced").length,
    invalid: contacts.filter((contact) => contact.status === "invalid").length,
  };
  const progressByLink = new Map<string, SmartBatchCampaign["progress"]>();
  for (const recipient of recipients ?? []) {
    if (!recipient.campaign_batch_id) continue;
    const progress = progressByLink.get(recipient.campaign_batch_id) ?? {
      total: 0,
      sent: 0,
      pending: 0,
      failed: 0,
      skipped: 0,
      replied: 0,
      percent: 0,
    };
    progress.total++;
    if (recipient.status === "sent") progress.sent++;
    else if (recipient.status === "failed" || recipient.status === "bounced") {
      progress.failed++;
    } else if (recipient.status === "skipped") progress.skipped++;
    else progress.pending++;
    if (recipient.replied_at) progress.replied++;
    progress.percent =
      progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;
    progressByLink.set(recipient.campaign_batch_id, progress);
  }

  return {
    batch: {
      ...batch,
      campaigns: (links ?? []).map((link) => ({
        id: link.id,
        campaignId: link.campaign_id,
        campaignName: names.get(link.campaign_id) ?? "Campaign",
        status: link.status,
        scheduledAt: link.scheduled_at,
        timezone: link.timezone,
        providerError: link.provider_error,
        progress: progressByLink.get(link.id) ?? {
          total: 0,
          sent: 0,
          pending: 0,
          failed: 0,
          skipped: 0,
          replied: 0,
          percent: 0,
        },
      })),
    },
    contacts,
    counts,
  };
}
