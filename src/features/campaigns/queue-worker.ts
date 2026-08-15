import type { SupabaseClient } from "@supabase/supabase-js";

import type { QueueBatchResult } from "@/features/campaigns/schemas";
import { getQueueConfig } from "@/lib/env";
import { userFacingEmailError } from "@/lib/email/errors";
import { renderCampaignEmail } from "@/lib/email/render";
import { resolveEmailProviderForAccount } from "@/lib/email/resolve-provider";
import { buildUnsubscribeUrl } from "@/lib/email/unsubscribe";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

const RETRY_BASE_DELAY_MS = 60_000;
const CLAIM_LEASE_MS = 5 * 60_000;

type AppSupabaseClient = SupabaseClient<Database>;

function getTrustedClient(fallback: AppSupabaseClient): AppSupabaseClient {
  try {
    return createServiceRoleClient();
  } catch {
    // Cron already passes service-role; local misconfig falls back.
    return fallback;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recoverExpiredClaims(
  supabase: AppSupabaseClient,
  userId: string,
  campaignId: string,
) {
  const nowIso = new Date().toISOString();

  await supabase
    .from("campaign_recipients")
    .update({
      status: "queued",
      claimed_at: null,
      claim_expires_at: null,
      last_error: "Recovered after stalled send claim",
    })
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .eq("status", "sending")
    .lt("claim_expires_at", nowIso);
}

async function pauseForAccountIssue(
  supabase: AppSupabaseClient,
  userId: string,
  campaignId: string,
  emailAccountId: string,
  reason: "rate_limit" | "auth_required",
  message: string,
  retryAfterMs?: number,
) {
  const rateLimitedUntil =
    reason === "rate_limit"
      ? new Date(Date.now() + (retryAfterMs ?? 15 * 60_000)).toISOString()
      : null;

  await supabase
    .from("email_accounts")
    .update({
      status: reason === "auth_required" ? "needs_reauth" : "rate_limited",
      last_error: message,
      rate_limited_until: rateLimitedUntil,
    })
    .eq("id", emailAccountId)
    .eq("user_id", userId);

  // Pause all sending campaigns that share this account.
  await supabase
    .from("campaigns")
    .update({
      status: "paused",
      paused_at: new Date().toISOString(),
      pause_reason: reason,
    })
    .eq("user_id", userId)
    .eq("email_account_id", emailAccountId)
    .eq("status", "sending");

  // Release unclaimed work for the current campaign back to queued.
  await supabase
    .from("campaign_recipients")
    .update({
      status: "queued",
      claimed_at: null,
      claim_expires_at: null,
      last_error: message,
      next_attempt_at:
        reason === "rate_limit" && rateLimitedUntil
          ? rateLimitedUntil
          : null,
    })
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .eq("status", "sending");
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
  const { batchSize, sendDelayMs } = getQueueConfig();

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

  if (!campaign.email_account_id) {
    await supabase
      .from("campaigns")
      .update({
        status: "paused",
        paused_at: new Date().toISOString(),
        pause_reason: "auth_required",
      })
      .eq("id", campaign.id)
      .eq("user_id", userId);

    return {
      error: "Gmail is not connected.",
      campaignStatus: "paused",
      processed: 0,
      remaining: 0,
    };
  }

  await recoverExpiredClaims(supabase, userId, campaign.id);

  // Credentials are never readable via authenticated RLS — use service role.
  const trusted = getTrustedClient(supabase);

  const resolved = await resolveEmailProviderForAccount(
    trusted,
    userId,
    campaign.email_account_id,
  );

  if (!resolved.ok) {
    const reason =
      resolved.code === "rate_limited" ? "rate_limit" : "auth_required";
    await pauseForAccountIssue(
      trusted,
      userId,
      campaign.id,
      campaign.email_account_id,
      reason,
      resolved.error,
    );

    return {
      error: resolved.error,
      campaignStatus: "paused",
      processed: 0,
      remaining: 0,
    };
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
    .limit(batchSize);

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
  const provider = resolved.value.provider;

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let retriesScheduled = 0;

  for (const recipient of batch) {
    // Re-check campaign is still sending (may have been paused mid-batch).
    const { data: liveCampaign } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", campaign.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!liveCampaign || liveCampaign.status !== "sending") {
      break;
    }

    const claimExpires = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
    const { data: claimed } = await supabase
      .from("campaign_recipients")
      .update({
        status: "sending",
        claimed_at: new Date().toISOString(),
        claim_expires_at: claimExpires,
      })
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
          last_error: "This recipient is unsubscribed.",
          claimed_at: null,
          claim_expires_at: null,
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

    const unsubscribeUrl = buildUnsubscribeUrl(contact.id);
    const rendered = renderCampaignEmail({
      subject: campaign.subject,
      htmlContent: campaign.html_content,
      textContent: campaign.text_content,
      vars: {
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
      },
      unsubscribeUrl,
    });

    const result = await provider.send({
      to: contact.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      from: resolved.value.email,
      fromName: resolved.value.displayName ?? undefined,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
      },
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
          provider_message_id: result.messageId ?? null,
          claimed_at: null,
          claim_expires_at: null,
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

      await trusted
        .from("email_accounts")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", resolved.value.accountId)
        .eq("user_id", userId);

      sent++;
    } else if (
      result.errorCode === "auth_required" ||
      result.errorCode === "rate_limited" ||
      result.errorCode === "quota_exceeded"
    ) {
      const reason =
        result.errorCode === "auth_required" ? "auth_required" : "rate_limit";
      const message = userFacingEmailError(result.errorCode, result.error);

      await pauseForAccountIssue(
        trusted,
        userId,
        campaign.id,
        campaign.email_account_id,
        reason,
        message,
        result.retryAfterMs,
      );

      return {
        processed,
        sent,
        failed,
        skipped,
        retriesScheduled,
        remaining: 0,
        campaignStatus: "paused",
        error: message,
      };
    } else if (result.retryable && attemptCount < recipient.max_attempts) {
      const backoffMs =
        result.retryAfterMs ?? RETRY_BASE_DELAY_MS * 2 ** (attemptCount - 1);

      await supabase
        .from("campaign_recipients")
        .update({
          status: "queued",
          attempt_count: attemptCount,
          last_error:
            userFacingEmailError(result.errorCode, result.error) ||
            "Unable to send this email. It will be retried.",
          next_attempt_at: new Date(Date.now() + backoffMs).toISOString(),
          claimed_at: null,
          claim_expires_at: null,
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
          last_error:
            userFacingEmailError(result.errorCode, result.error) ||
            "Send failed",
          next_attempt_at: null,
          claimed_at: null,
          claim_expires_at: null,
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

    await sleep(sendDelayMs);
  }

  const { count: remainingCount } = await supabase
    .from("campaign_recipients")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId)
    .in("status", ["pending", "queued", "sending"]);

  let campaignStatus = "sending";

  const { data: stillSending } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", campaign.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (stillSending?.status === "paused") {
    campaignStatus = "paused";
  } else if ((remainingCount ?? 0) === 0) {
    await supabase
      .from("campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaign.id)
      .eq("user_id", userId)
      .eq("status", "sending");
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
