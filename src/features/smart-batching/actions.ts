"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getQueueConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const batchSizeSchema = z.coerce.number().int().min(1).max(1000);

export type SmartBatchActionState = {
  error?: string;
  success?: string;
  batchesCreated?: number;
  contactsBatched?: number;
  batchSize?: number;
  batchIds?: string[];
  queued?: number;
};

type BatchRpcResult = {
  batch_ids?: string[];
  batches_created?: number;
  contacts_batched?: number;
  batch_size?: number;
};

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function validateCampaignSender(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  campaignId: string,
): Promise<string | undefined> {
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("email_account_id")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!campaign?.email_account_id) {
    return "Choose a connected Gmail account for this campaign first.";
  }
  const { data: account } = await supabase
    .from("email_accounts")
    .select("status")
    .eq("id", campaign.email_account_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    !account ||
    account.status === "needs_reauth" ||
    account.status === "disconnected"
  ) {
    return "Your Gmail account needs to be reconnected.";
  }
  if (account.status === "rate_limited") {
    return "Gmail reported a sending limit. The selected batches remain paused until the account is available.";
  }
}

function rpcError(
  error: { message?: string; code?: string; details?: string | null },
  fallback: string,
): string {
  const message = (error.message ?? "").trim();
  if (message.includes("No eligible contacts")) {
    return "No eligible active contacts were selected.";
  }
  if (
    error.code === "42P01" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    message.includes("migration") ||
    message.includes("schema cache")
  ) {
    return "Smart Batching requires the latest Supabase migration.";
  }
  console.error("[smart-batching] database call failed", error);
  // Surface the database reason: the guards above raise operator-readable text,
  // and hiding anything else makes these failures impossible to diagnose.
  return message ? `${fallback} ${message}` : fallback;
}

export async function createContactBatchesAction(
  contactIds: string[],
  batchSize: number,
  source: "manual" | "import" | "paste" | "email_finder" | "campaign_import" =
    "manual",
): Promise<SmartBatchActionState> {
  const parsed = z
    .object({
      contactIds: z.array(uuid).min(1).max(10_000),
      batchSize: batchSizeSchema,
      source: z.enum([
        "manual",
        "import",
        "paste",
        "email_finder",
        "campaign_import",
      ]),
    })
    .safeParse({ contactIds: [...new Set(contactIds)], batchSize, source });
  if (!parsed.success) {
    return { error: "Select contacts and choose a batch size from 1 to 1,000." };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data, error } = await supabase.rpc("create_contact_batches", {
    p_contact_ids: parsed.data.contactIds,
    p_batch_size: parsed.data.batchSize,
    p_source: parsed.data.source,
    p_name_prefix: "Batch",
  });
  if (error) return { error: rpcError(error, "Unable to create Smart Batches.") };

  const result = (data ?? {}) as BatchRpcResult;
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return {
    success: `${result.batches_created ?? 0} batch${
      result.batches_created === 1 ? "" : "es"
    } created for ${result.contacts_batched ?? 0} contacts.`,
    batchesCreated: result.batches_created,
    contactsBatched: result.contacts_batched,
    batchSize: result.batch_size,
    batchIds: result.batch_ids,
  };
}

export async function saveDefaultBatchSizeAction(
  batchSize: number,
): Promise<SmartBatchActionState> {
  const parsed = batchSizeSchema.safeParse(batchSize);
  if (!parsed.success) return { error: "Batch size must be between 1 and 1,000." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { error } = await supabase
    .from("profiles")
    .update({ default_batch_size: parsed.data })
    .eq("id", user.id);
  if (error) return { error: "Unable to save your default batch size." };
  revalidatePath("/contacts");
  revalidatePath("/settings");
  return { success: `Default batch size set to ${parsed.data}.` };
}

export async function renameContactBatchAction(
  batchId: string,
  name: string,
): Promise<SmartBatchActionState> {
  const parsed = z
    .object({ batchId: uuid, name: z.string().trim().min(1).max(120) })
    .safeParse({ batchId, name });
  if (!parsed.success) return { error: "Enter a batch name up to 120 characters." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const { data, error } = await supabase
    .from("contact_batches")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.batchId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "Unable to rename this batch." };
  revalidatePath("/contacts");
  revalidatePath(`/batches/${batchId}`);
  return { success: "Batch renamed." };
}

export async function deleteContactBatchAction(
  batchId: string,
): Promise<SmartBatchActionState> {
  const parsed = uuid.safeParse(batchId);
  if (!parsed.success) return { error: "Invalid batch reference." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { count } = await supabase
    .from("campaign_batches")
    .select("*", { count: "exact", head: true })
    .eq("batch_id", parsed.data)
    .eq("user_id", user.id)
    .in("status", ["scheduled", "processing"]);
  if ((count ?? 0) > 0) {
    return { error: "Pause or cancel active campaign sends before deleting this batch." };
  }

  const { data, error } = await supabase
    .from("contact_batches")
    .delete()
    .eq("id", parsed.data)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "Unable to delete this batch." };
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return { success: "Batch deleted. Its contacts remain in Contacts." };
}

export async function deleteContactBatchesAction(
  batchIds: string[],
): Promise<SmartBatchActionState> {
  const parsed = z
    .object({ batchIds: z.array(uuid).min(1).max(200) })
    .safeParse({ batchIds: [...new Set(batchIds)] });
  if (!parsed.success) return { error: "Select at least one batch to delete." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { count: activeCount } = await supabase
    .from("campaign_batches")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .in("batch_id", parsed.data.batchIds)
    .in("status", ["scheduled", "processing"]);
  if ((activeCount ?? 0) > 0) {
    return {
      error:
        "One or more selected batches have active campaign sends. Pause or cancel them first.",
    };
  }

  // PostgREST encodes .in() as a URL query string; large arrays exceed limits.
  // Chunk into groups of 10 to stay well within URL length constraints.
  const CHUNK = 10;
  const ids = parsed.data.batchIds;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("contact_batches")
      .delete()
      .eq("user_id", user.id)
      .in("id", chunk)
      .select("id");
    if (error) return { error: "Unable to delete the selected batches." };
    deleted += (data ?? []).length;
  }
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return {
    success: `${deleted} batch${deleted === 1 ? "" : "es"} deleted. Contacts remain in Contacts.`,
  };
}

export async function removeContactFromBatchAction(
  batchId: string,
  membershipId: string,
): Promise<SmartBatchActionState> {
  const parsed = z
    .object({ batchId: uuid, membershipId: uuid })
    .safeParse({ batchId, membershipId });
  if (!parsed.success) return { error: "Invalid batch membership." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { count: activeCount } = await supabase
    .from("campaign_batches")
    .select("*", { count: "exact", head: true })
    .eq("batch_id", parsed.data.batchId)
    .eq("user_id", user.id)
    .in("status", ["scheduled", "processing"]);
  if ((activeCount ?? 0) > 0) {
    return {
      error:
        "Pause or cancel active campaign sending before changing this batch.",
    };
  }

  const { error } = await supabase
    .from("contact_batch_members")
    .delete()
    .eq("id", parsed.data.membershipId)
    .eq("batch_id", parsed.data.batchId)
    .eq("user_id", user.id);
  if (error) return { error: "Unable to remove this contact from the batch." };

  const { count } = await supabase
    .from("contact_batch_members")
    .select("*", { count: "exact", head: true })
    .eq("batch_id", parsed.data.batchId)
    .eq("user_id", user.id);
  await supabase
    .from("contact_batches")
    .update({ total_contacts: count ?? 0 })
    .eq("id", parsed.data.batchId)
    .eq("user_id", user.id);

  revalidatePath("/contacts");
  revalidatePath(`/batches/${batchId}`);
  return { success: "Removed from batch. The contact remains in Contacts." };
}

export async function copyContactBatchEmailsAction(
  batchIds: string[],
): Promise<{ error?: string; text?: string; count?: number }> {
  const parsed = z
    .object({ batchIds: z.array(uuid).min(1).max(200) })
    .safeParse({ batchIds: [...new Set(batchIds)] });
  if (!parsed.success) {
    return { error: "Select at least one batch to copy." };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: ownedBatches } = await supabase
    .from("contact_batches")
    .select("id")
    .eq("user_id", user.id)
    .in("id", parsed.data.batchIds);
  const ownedIds = new Set((ownedBatches ?? []).map((batch) => batch.id));
  if (ownedIds.size === 0) {
    return { error: "No matching batches were found." };
  }

  const orderedIds = parsed.data.batchIds.filter((id) => ownedIds.has(id));
  const emails: string[] = [];
  const seen = new Set<string>();

  for (const batchId of orderedIds) {
    const { data: members, error } = await supabase
      .from("contact_batch_members")
      .select("position, contacts!inner(email, email_normalized)")
      .eq("batch_id", batchId)
      .eq("user_id", user.id)
      .order("position", { ascending: true });
    if (error) {
      return { error: "Unable to load emails from the selected batches." };
    }
    for (const member of members ?? []) {
      const contact = Array.isArray(member.contacts)
        ? member.contacts[0]
        : member.contacts;
      if (!contact?.email) continue;
      const normalized = (contact.email_normalized ?? contact.email).toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      emails.push(contact.email);
    }
  }

  if (emails.length === 0) {
    return { error: "No emails were found in the selected batches." };
  }

  return { text: emails.join("\n"), count: emails.length };
}

export async function addBatchesToCampaignAction(
  campaignId: string,
  batchIds: string[],
): Promise<SmartBatchActionState> {
  const parsed = z
    .object({ campaignId: uuid, batchIds: z.array(uuid).min(1).max(200) })
    .safeParse({ campaignId, batchIds: [...new Set(batchIds)] });
  if (!parsed.success) return { error: "Select a draft campaign and at least one batch." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data, error } = await supabase.rpc("enroll_contact_batches", {
    p_campaign_id: parsed.data.campaignId,
    p_batch_ids: parsed.data.batchIds,
  });
  if (error) {
    return { error: rpcError(error, "Unable to add these batches to the campaign.") };
  }
  const result = (data ?? {}) as {
    batches_linked?: number;
    contacts_enrolled?: number;
  };
  revalidatePath("/contacts");
  revalidatePath(`/campaigns/${campaignId}`);
  return {
    success: `${result.contacts_enrolled ?? 0} contacts enrolled from ${
      parsed.data.batchIds.length
    } selected batch${parsed.data.batchIds.length === 1 ? "" : "es"}.`,
  };
}

export async function queueCampaignBatchAction(input: {
  campaignId: string;
  batchId: string;
  scheduledAt?: string | null;
  timezone?: string;
}): Promise<SmartBatchActionState> {
  const parsed = z
    .object({
      campaignId: uuid,
      batchId: uuid,
      scheduledAt: z.string().datetime().nullable().optional(),
      timezone: z.string().trim().min(1).max(100).default("UTC"),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Choose a valid batch schedule." };
  if (
    parsed.data.scheduledAt &&
    new Date(parsed.data.scheduledAt).getTime() <= Date.now()
  ) {
    return { error: "Scheduled batch time must be in the future." };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const senderError = await validateCampaignSender(
    supabase,
    user.id,
    parsed.data.campaignId,
  );
  if (senderError) return { error: senderError };

  const { maxRetries } = getQueueConfig();
  const { data, error } = await supabase.rpc("queue_campaign_batch", {
    p_campaign_id: parsed.data.campaignId,
    p_batch_id: parsed.data.batchId,
    p_scheduled_at: parsed.data.scheduledAt ?? null,
    p_timezone: parsed.data.timezone,
    p_max_attempts: maxRetries,
  });
  if (error) return { error: rpcError(error, "Unable to queue this batch.") };
  const result = (data ?? {}) as { queued?: number };
  revalidatePath(`/campaigns/${parsed.data.campaignId}`);
  revalidatePath(`/batches/${parsed.data.batchId}`);
  revalidatePath("/contacts");
  return {
    queued: result.queued ?? 0,
    success: parsed.data.scheduledAt
      ? `${result.queued ?? 0} emails scheduled through the existing queue.`
      : `${result.queued ?? 0} emails queued and sending now.`,
  };
}

export async function queueCampaignBatchesAction(input: {
  campaignId: string;
  batchIds: string[];
  timezone?: string;
}): Promise<SmartBatchActionState> {
  const parsed = z
    .object({
      campaignId: uuid,
      batchIds: z.array(uuid).min(1).max(200),
      timezone: z.string().trim().min(1).max(100).default("UTC"),
    })
    .safeParse({ ...input, batchIds: [...new Set(input.batchIds)] });
  if (!parsed.success) {
    return { error: "Select at least one ready batch to send." };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const senderError = await validateCampaignSender(
    supabase,
    user.id,
    parsed.data.campaignId,
  );
  if (senderError) return { error: senderError };

  const { maxRetries } = getQueueConfig();
  const { data, error } = await supabase.rpc("queue_campaign_batches", {
    p_campaign_id: parsed.data.campaignId,
    p_batch_ids: parsed.data.batchIds,
    p_scheduled_at: null,
    p_timezone: parsed.data.timezone,
    p_max_attempts: maxRetries,
  });
  if (error) {
    return {
      error: rpcError(error, "Unable to queue the selected batches."),
    };
  }

  const result = (data ?? {}) as {
    queued?: number;
    batches_queued?: number;
    batches_skipped?: number;
  };
  revalidatePath(`/campaigns/${parsed.data.campaignId}`);
  revalidatePath("/contacts");
  return {
    queued: result.queued ?? 0,
    success: `${result.queued ?? 0} emails from ${
      result.batches_queued ?? parsed.data.batchIds.length
    } batches queued and sending now.${
      result.batches_skipped
        ? ` ${result.batches_skipped} fully duplicated batch${
            result.batches_skipped === 1 ? " was" : "es were"
          } skipped.`
        : ""
    }`,
  };
}

export async function setCampaignBatchPausedAction(
  campaignBatchId: string,
  paused: boolean,
): Promise<SmartBatchActionState> {
  const id = uuid.safeParse(campaignBatchId);
  if (!id.success) return { error: "Invalid campaign batch reference." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const { data: link } = await supabase
    .from("campaign_batches")
    .select("id, campaign_id, batch_id, status, scheduled_at")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!link) return { error: "Campaign batch not found." };
  if (paused && !["processing", "scheduled"].includes(link.status)) {
    return { error: "Only scheduled or processing batches can be paused." };
  }
  if (!paused && link.status !== "paused") {
    return { error: "Only paused batches can be resumed." };
  }

  const nextStatus = paused
    ? "paused"
    : link.scheduled_at && new Date(link.scheduled_at).getTime() > Date.now()
      ? "scheduled"
      : "processing";
  const { error } = await supabase
    .from("campaign_batches")
    .update({ status: nextStatus, provider_error: null })
    .eq("id", link.id)
    .eq("user_id", user.id);
  if (error) return { error: paused ? "Unable to pause this batch." : "Unable to resume this batch." };
  await supabase
    .from("contact_batches")
    .update({ status: nextStatus })
    .eq("id", link.batch_id)
    .eq("user_id", user.id);
  if (paused) {
    const { count: activeBatchCount } = await supabase
      .from("campaign_batches")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", link.campaign_id)
      .eq("user_id", user.id)
      .in("status", ["processing", "scheduled"]);
    if ((activeBatchCount ?? 0) === 0) {
      await supabase
        .from("campaigns")
        .update({
          status: "paused",
          paused_at: new Date().toISOString(),
          pause_reason: "manual",
        })
        .eq("id", link.campaign_id)
        .eq("user_id", user.id);
    }
  } else {
    await supabase
      .from("campaigns")
      .update({
        status: nextStatus === "scheduled" ? "scheduled" : "sending",
        paused_at: null,
        pause_reason: null,
        completed_at: null,
      })
      .eq("id", link.campaign_id)
      .eq("user_id", user.id);
  }
  await supabase.from("campaign_activity").insert({
    user_id: user.id,
    campaign_id: link.campaign_id,
    campaign_batch_id: link.id,
    event_type: paused ? "batch_paused" : "batch_resumed",
  });
  revalidatePath(`/campaigns/${link.campaign_id}`);
  revalidatePath(`/batches/${link.batch_id}`);
  revalidatePath("/contacts");
  return { success: paused ? "Batch paused." : "Batch resumed." };
}
