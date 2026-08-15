import type { SupabaseClient } from "@supabase/supabase-js";

import type { QueueBatchResult } from "@/features/campaigns/schemas";
import { getEmailProvider } from "@/lib/email/provider";
import { renderCampaignEmail } from "@/lib/email/render";
import { buildUnsubscribeUrl } from "@/lib/email/unsubscribe";
import type { Database } from "@/lib/supabase/database.types";

const QUEUE_BATCH_SIZE = 5;
const SEND_SPACING_MS = 400;
const RETRY_BASE_DELAY_MS = 60_000;

type AppSupabaseClient = SupabaseClient<Database>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Processes one campaign queue batch.
 *
 * The client controls authorization: browser-triggered calls use an authenticated
 * RLS client; cron calls use the service-role client. A conditional status update
 * claims each row before sending so overlapping workers cannot send it twice.
 */
export async function processCampaignQueueBatch(
  supabase: AppSupabaseClient,
  userId: string,
  campaignId: string,
): Promise<QueueBatchResult> {
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", userId)
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
    .eq("user_id", userId)
    .in("status", ["pending", "queued"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(QUEUE_BATCH_SIZE);

  if (batchError) {
    return { error: "Unable to read the email queue." };
  }

  if (!batch || batch.length === 0) {
    const { count: remainingCount } = await supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("user_id", userId)
      .in("status", ["pending", "queued", "sending"]);

    if ((remainingCount ?? 0) === 0) {
      await supabase
        .from("campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign.id)
        .eq("user_id", userId);

      return { processed: 0, remaining: 0, campaignStatus: "completed" };
    }

    return {
      processed: 0,
      remaining: remainingCount ?? 0,
      campaignStatus: "sending",
    };
  }

  const contactIds = batch.map((recipient) => recipient.contact_id);
  const [{ data: contacts }, { data: suppressed }] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, email, email_normalized, is_unsubscribed, is_suppressed",
      )
      .eq("user_id", userId)
      .in("id", contactIds),
    supabase
      .from("suppression_list")
      .select("email_normalized")
      .eq("user_id", userId),
  ]);

  const contactMap = new Map((contacts ?? []).map((contact) => [contact.id, contact]));
  const suppressedSet = new Set((suppressed ?? []).map((row) => row.email_normalized));
  const provider = getEmailProvider();

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let retriesScheduled = 0;

  for (const recipient of batch) {
    // Claim this queue row. If another worker already claimed it, skip it.
    const { data: claimed } = await supabase
      .from("campaign_recipients")
      .update({ status: "sending" })
      .eq("id", recipient.id)
      .eq("user_id", userId)
      .in("status", ["pending", "queued"])
      .select("id")
      .maybeSingle();

    if (!claimed) {
      continue;
    }

    processed++;
    const contact = contactMap.get(recipient.contact_id);

    if (
      !contact ||
      contact.is_unsubscribed ||
      contact.is_suppressed ||
      suppressedSet.has(contact.email_normalized)
    ) {
      await supabase
        .from("campaign_recipients")
        .update({
          status: "skipped",
          last_error: "Recipient is unsubscribed or suppressed",
        })
        .eq("id", recipient.id)
        .eq("user_id", userId);

      await supabase.from("email_events").insert({
        user_id: userId,
        campaign_id: campaign.id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type: "failed",
        metadata: { reason: "suppressed_or_unsubscribed", skipped: true },
      });

      skipped++;
      continue;
    }

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
        .eq("user_id", userId);

      await supabase.from("email_events").insert({
        user_id: userId,
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
        .eq("user_id", userId);

      await supabase.from("email_events").insert({
        user_id: userId,
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
        .eq("user_id", userId);

      await supabase.from("email_events").insert({
        user_id: userId,
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
    .eq("user_id", userId)
    .in("status", ["pending", "queued", "sending"]);

  let campaignStatus = "sending";

  if ((remainingCount ?? 0) === 0) {
    await supabase
      .from("campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaign.id)
      .eq("user_id", userId);
    campaignStatus = "completed";
  }

  return {
    processed,
    sent,
    failed,
    skipped,
    retriesScheduled,
    remaining: remainingCount ?? 0,
    campaignStatus,
  };
}
