"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  campaignSchema,
  resolveCampaignSubject,
  type CampaignActionState,
  type QueueBatchResult,
} from "@/features/campaigns/schemas";
import { getEmailProvider } from "@/lib/email/provider";
import { renderCampaignEmail } from "@/lib/email/render";
import { buildUnsubscribeUrl } from "@/lib/email/unsubscribe";
import { createClient } from "@/lib/supabase/server";

/** Emails handled per queue invocation — keeps sending gradual. */
const QUEUE_BATCH_SIZE = 5;
/** Delay between individual sends inside a batch. */
const SEND_SPACING_MS = 400;
/** Retry backoff base (doubles per attempt). */
const RETRY_BASE_DELAY_MS = 60_000;

const uuidSchema = z.string().uuid();

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

function parseCampaignForm(formData: FormData) {
  return campaignSchema.safeParse({
    name: formData.get("name"),
    subject: formData.get("subject"),
    htmlContent: formData.get("htmlContent"),
    textContent: formData.get("textContent") ?? "",
  });
}

export async function createCampaignAction(
  _prev: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const parsed = parseCampaignForm(formData);

  if (!parsed.success) {
    return {
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      subject: resolveCampaignSubject(parsed.data.name, parsed.data.subject),
      html_content: parsed.data.htmlContent,
      text_content: parsed.data.textContent || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: "Unable to create the campaign. Please try again." };
  }

  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  redirect(`/campaigns/${data.id}`);
}

export async function updateCampaignAction(
  _prev: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const idResult = uuidSchema.safeParse(formData.get("campaignId"));
  const parsed = parseCampaignForm(formData);

  if (!idResult.success) {
    return { error: "Invalid campaign reference." };
  }

  if (!parsed.success) {
    return {
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { data: existing } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) {
    return { error: "Campaign not found." };
  }

  if (existing.status !== "draft") {
    return { error: "Only draft campaigns can be edited." };
  }

  const { error } = await supabase
    .from("campaigns")
    .update({
      name: parsed.data.name,
      subject: resolveCampaignSubject(parsed.data.name, parsed.data.subject),
      html_content: parsed.data.htmlContent,
      text_content: parsed.data.textContent || null,
    })
    .eq("id", idResult.data)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Unable to update the campaign. Please try again." };
  }

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${idResult.data}`);
  return { success: "Campaign updated.", campaignId: idResult.data };
}

export async function deleteCampaignAction(campaignId: string): Promise<CampaignActionState> {
  const idResult = uuidSchema.safeParse(campaignId);
  if (!idResult.success) {
    return { error: "Invalid campaign reference." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", idResult.data)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Unable to delete the campaign." };
  }

  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  return { success: "Campaign deleted." };
}

export async function sendTestEmailAction(campaignId: string): Promise<CampaignActionState> {
  const idResult = uuidSchema.safeParse(campaignId);
  if (!idResult.success) {
    return { error: "Invalid campaign reference." };
  }

  const { supabase, user } = await requireUser();
  if (!user || !user.email) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!campaign) {
    return { error: "Campaign not found." };
  }

  const provider = getEmailProvider();

  const rendered = renderCampaignEmail({
    subject: `[TEST] ${campaign.subject}`,
    htmlContent: campaign.html_content,
    textContent: campaign.text_content,
    vars: {
      first_name: "Test",
      last_name: "Recipient",
      email: user.email,
    },
    unsubscribeUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/unsubscribe?test=1`,
  });

  const result = await provider.send({
    to: user.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  if (!result.success) {
    return { error: `Test send failed: ${result.error ?? "unknown error"}` };
  }

  return {
    success:
      provider.name === "console"
        ? "Test email logged to the server console (console provider is active)."
        : `Test email sent to ${user.email}.`,
  };
}

export async function startCampaignAction(
  campaignId: string,
  contactIds: string[] | "all",
): Promise<CampaignActionState> {
  const idResult = uuidSchema.safeParse(campaignId);
  if (!idResult.success) {
    return { error: "Invalid campaign reference." };
  }

  if (contactIds !== "all") {
    const idsResult = z.array(uuidSchema).min(1).max(10_000).safeParse(contactIds);
    if (!idsResult.success) {
      return { error: "Select at least one contact." };
    }
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!campaign) {
    return { error: "Campaign not found." };
  }

  if (campaign.status !== "draft") {
    return { error: "This campaign has already been started." };
  }

  // Only contacts that are currently eligible — never unsubscribed/suppressed.
  let contactsQuery = supabase
    .from("contacts")
    .select("id, email, email_normalized")
    .eq("user_id", user.id)
    .eq("is_unsubscribed", false)
    .eq("is_suppressed", false);

  if (contactIds !== "all") {
    contactsQuery = contactsQuery.in("id", contactIds);
  }

  const { data: contacts, error: contactsError } = await contactsQuery;

  if (contactsError) {
    return { error: "Unable to load contacts for this campaign." };
  }

  if (!contacts || contacts.length === 0) {
    return { error: "No eligible (subscribed) contacts to send to." };
  }

  // Exclude anything on the suppression list.
  const { data: suppressed } = await supabase
    .from("suppression_list")
    .select("email_normalized")
    .eq("user_id", user.id);

  const suppressedSet = new Set((suppressed ?? []).map((row) => row.email_normalized));
  const eligible = contacts.filter(
    (contact) => !suppressedSet.has(contact.email_normalized),
  );

  if (eligible.length === 0) {
    return { error: "All selected contacts are on the suppression list." };
  }

  const recipients = eligible.map((contact) => ({
    campaign_id: campaign.id,
    contact_id: contact.id,
    user_id: user.id,
    email: contact.email,
    status: "queued" as const,
    queued_at: new Date().toISOString(),
  }));

  const CHUNK_SIZE = 500;
  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const chunk = recipients.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("campaign_recipients")
      .upsert(chunk, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });

    if (error) {
      return { error: "Unable to queue campaign recipients. Please try again." };
    }
  }

  const { error: statusError } = await supabase
    .from("campaigns")
    .update({ status: "sending", started_at: new Date().toISOString() })
    .eq("id", campaign.id)
    .eq("user_id", user.id);

  if (statusError) {
    return { error: "Recipients were queued but the campaign could not be started." };
  }

  await supabase.from("email_events").insert({
    user_id: user.id,
    campaign_id: campaign.id,
    event_type: "queued",
    metadata: { recipients: eligible.length },
  });

  revalidatePath(`/campaigns/${campaign.id}`);
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  return {
    success: `Campaign started: ${eligible.length} recipient(s) queued.`,
    campaignId: campaign.id,
  };
}

export async function pauseCampaignAction(campaignId: string): Promise<CampaignActionState> {
  return setCampaignPaused(campaignId, true);
}

export async function resumeCampaignAction(campaignId: string): Promise<CampaignActionState> {
  return setCampaignPaused(campaignId, false);
}

async function setCampaignPaused(
  campaignId: string,
  paused: boolean,
): Promise<CampaignActionState> {
  const idResult = uuidSchema.safeParse(campaignId);
  if (!idResult.success) {
    return { error: "Invalid campaign reference." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!campaign) {
    return { error: "Campaign not found." };
  }

  if (paused && campaign.status !== "sending") {
    return { error: "Only sending campaigns can be paused." };
  }

  if (!paused && campaign.status !== "paused") {
    return { error: "Only paused campaigns can be resumed." };
  }

  const { error } = await supabase
    .from("campaigns")
    .update(
      paused
        ? { status: "paused", paused_at: new Date().toISOString() }
        : { status: "sending", paused_at: null },
    )
    .eq("id", campaign.id)
    .eq("user_id", user.id);

  if (error) {
    return { error: paused ? "Unable to pause the campaign." : "Unable to resume the campaign." };
  }

  revalidatePath(`/campaigns/${campaign.id}`);
  revalidatePath("/campaigns");
  return { success: paused ? "Campaign paused." : "Campaign resumed." };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Processes one small batch of queued emails for a sending campaign.
 * Called repeatedly (poller on the campaign page or an external cron)
 * so delivery is gradual instead of all at once.
 */
export async function processQueueBatchAction(campaignId: string): Promise<QueueBatchResult> {
  const idResult = uuidSchema.safeParse(campaignId);
  if (!idResult.success) {
    return { error: "Invalid campaign reference." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!campaign) {
    return { error: "Campaign not found." };
  }

  if (campaign.status !== "sending") {
    return { campaignStatus: campaign.status, processed: 0, remaining: 0 };
  }

  const nowIso = new Date().toISOString();

  const { data: batch, error: batchError } = await supabase
    .from("campaign_recipients")
    .select("*")
    .eq("campaign_id", campaign.id)
    .eq("user_id", user.id)
    .in("status", ["pending", "queued"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(QUEUE_BATCH_SIZE);

  if (batchError) {
    return { error: "Unable to read the email queue." };
  }

  if (!batch || batch.length === 0) {
    // Nothing ready right now. Complete the campaign if the queue is drained.
    const { count: remainingCount } = await supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("user_id", user.id)
      .in("status", ["pending", "queued", "sending"]);

    if ((remainingCount ?? 0) === 0) {
      await supabase
        .from("campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign.id)
        .eq("user_id", user.id);

      revalidatePath(`/campaigns/${campaign.id}`);
      revalidatePath("/campaigns");
      revalidatePath("/dashboard");
      return { processed: 0, remaining: 0, campaignStatus: "completed" };
    }

    return { processed: 0, remaining: remainingCount ?? 0, campaignStatus: "sending" };
  }

  // Load current suppression state for this batch.
  const contactIds = batch.map((recipient) => recipient.contact_id);

  const [{ data: contacts }, { data: suppressed }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, first_name, last_name, email, email_normalized, is_unsubscribed, is_suppressed")
      .eq("user_id", user.id)
      .in("id", contactIds),
    supabase
      .from("suppression_list")
      .select("email_normalized")
      .eq("user_id", user.id),
  ]);

  const contactMap = new Map((contacts ?? []).map((contact) => [contact.id, contact]));
  const suppressedSet = new Set((suppressed ?? []).map((row) => row.email_normalized));

  const provider = getEmailProvider();

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let retriesScheduled = 0;

  for (const recipient of batch) {
    const contact = contactMap.get(recipient.contact_id);

    // Compliance check at send time — never send to unsubscribed/suppressed.
    if (
      !contact ||
      contact.is_unsubscribed ||
      contact.is_suppressed ||
      suppressedSet.has(contact.email_normalized)
    ) {
      await supabase
        .from("campaign_recipients")
        .update({ status: "skipped", last_error: "Recipient is unsubscribed or suppressed" })
        .eq("id", recipient.id)
        .eq("user_id", user.id);

      await supabase.from("email_events").insert({
        user_id: user.id,
        campaign_id: campaign.id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type: "failed",
        metadata: { reason: "suppressed_or_unsubscribed", skipped: true },
      });

      skipped++;
      continue;
    }

    await supabase
      .from("campaign_recipients")
      .update({ status: "sending" })
      .eq("id", recipient.id)
      .eq("user_id", user.id);

    const rendered = renderCampaignEmail({
      subject: campaign.subject,
      htmlContent: campaign.html_content,
      textContent: campaign.text_content,
      vars: {
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
      },
      unsubscribeUrl: buildUnsubscribeUrl(contact.id),
    });

    const result = await provider.send({
      to: contact.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    const attemptCount = recipient.attempt_count + 1;

    if (result.success) {
      await supabase
        .from("campaign_recipients")
        .update({
          status: "sent",
          attempt_count: attemptCount,
          sent_at: new Date().toISOString(),
          last_error: null,
          next_attempt_at: null,
        })
        .eq("id", recipient.id)
        .eq("user_id", user.id);

      await supabase.from("email_events").insert({
        user_id: user.id,
        campaign_id: campaign.id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type: "sent",
        provider: result.provider,
        provider_message_id: result.messageId ?? null,
      });

      sent++;
    } else if (result.retryable && attemptCount < recipient.max_attempts) {
      const backoffMs = RETRY_BASE_DELAY_MS * 2 ** (attemptCount - 1);

      await supabase
        .from("campaign_recipients")
        .update({
          status: "queued",
          attempt_count: attemptCount,
          last_error: result.error ?? "Temporary failure",
          next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
        })
        .eq("id", recipient.id)
        .eq("user_id", user.id);

      await supabase.from("email_events").insert({
        user_id: user.id,
        campaign_id: campaign.id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type: "retry_scheduled",
        provider: result.provider,
        metadata: { attempt: attemptCount, error: result.error ?? null },
      });

      retriesScheduled++;
    } else {
      await supabase
        .from("campaign_recipients")
        .update({
          status: "failed",
          attempt_count: attemptCount,
          failed_at: new Date().toISOString(),
          last_error: result.error ?? "Send failed",
          next_attempt_at: null,
        })
        .eq("id", recipient.id)
        .eq("user_id", user.id);

      await supabase.from("email_events").insert({
        user_id: user.id,
        campaign_id: campaign.id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type: "failed",
        provider: result.provider,
        metadata: { attempt: attemptCount, error: result.error ?? null },
      });

      failed++;
    }

    await sleep(SEND_SPACING_MS);
  }

  const { count: remainingCount } = await supabase
    .from("campaign_recipients")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("user_id", user.id)
    .in("status", ["pending", "queued", "sending"]);

  let campaignStatus = "sending";

  if ((remainingCount ?? 0) === 0) {
    await supabase
      .from("campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaign.id)
      .eq("user_id", user.id);
    campaignStatus = "completed";
  }

  revalidatePath(`/campaigns/${campaign.id}`);
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");

  return {
    processed: batch.length,
    sent,
    failed,
    skipped,
    retriesScheduled,
    remaining: remainingCount ?? 0,
    campaignStatus,
  };
}
