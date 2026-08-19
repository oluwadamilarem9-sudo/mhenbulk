import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  subjectForSend,
  type QueueBatchResult,
} from "@/features/campaigns/schemas";
import { materializeDueAutomatedRecipients } from "@/features/campaigns/sequence-scheduler";
import { getQueueConfig } from "@/lib/env";
import { userFacingEmailError } from "@/lib/email/errors";
import { renderCampaignEmail } from "@/lib/email/render";
import { resolveEmailProviderForAccount } from "@/lib/email/resolve-provider";
import { buildUnsubscribeUrl } from "@/lib/email/unsubscribe";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

const RETRY_BASE_DELAY_MS = 60_000;
// Long enough for a Gmail round-trip to finish, short enough that a killed
// serverless request does not freeze the queue for a quarter of an hour.
const CLAIM_LEASE_MS = 2 * 60_000;
const STOP_CLAIMING_BEFORE_DEADLINE_MS = 1_500;

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

  const { data: recovered } = await supabase
    .from("campaign_recipients")
    .update({
      status: "queued",
      claimed_at: null,
      claim_expires_at: null,
      claim_token: null,
      last_error: "Recovered after stalled send claim",
    })
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .eq("status", "sending")
    .lt("claim_expires_at", nowIso)
    .select("id, campaign_batch_id, email_account_id");

  for (const row of recovered ?? []) {
    console.info("[QUEUE] Job recovered", {
      jobId: row.id,
      campaignId,
      batchId: row.campaign_batch_id,
      sendingAccountId: row.email_account_id,
    });
  }
}

async function pauseForAccountIssue(
  supabase: AppSupabaseClient,
  userId: string,
  emailAccountId: string,
  reason: "rate_limit" | "auth_required" | "provider_disabled",
  message: string,
  retryAfterMs?: number,
) {
  const rateLimitedUntil =
    reason === "rate_limit"
      ? new Date(Date.now() + (retryAfterMs ?? 15 * 60_000)).toISOString()
      : null;

  // A disabled provider API is an app-side problem, so the user's connection
  // stays valid and no reconnect is required.
  await supabase
    .from("email_accounts")
    .update(
      reason === "provider_disabled"
        ? { last_error: message }
        : {
            status: reason === "auth_required" ? "needs_reauth" : "rate_limited",
            last_error: message,
            rate_limited_until: rateLimitedUntil,
          },
    )
    .eq("id", emailAccountId)
    .eq("user_id", userId);

  // Pause all sending campaigns that share this account.
  const { data: affectedCampaigns } = await supabase
    .from("campaigns")
    .update({
      status: "paused",
      paused_at: new Date().toISOString(),
      pause_reason: reason,
    })
    .eq("user_id", userId)
    .eq("email_account_id", emailAccountId)
    .eq("status", "sending")
    .select("id");

  const affectedIds = (affectedCampaigns ?? []).map((campaign) => campaign.id);
  if (affectedIds.length) {
    const { data: affectedBatches } = await supabase
      .from("campaign_batches")
      .select("batch_id")
      .eq("user_id", userId)
      .in("campaign_id", affectedIds)
      .in("status", ["processing", "scheduled"]);
    await supabase
      .from("campaign_batches")
      .update({
        status: "paused",
        provider_error: message,
      })
      .eq("user_id", userId)
      .in("campaign_id", affectedIds)
      .in("status", ["processing", "scheduled"]);
    const batchIds = [
      ...new Set((affectedBatches ?? []).map((batch) => batch.batch_id)),
    ];
    if (batchIds.length) {
      await supabase
        .from("contact_batches")
        .update({ status: "paused" })
        .eq("user_id", userId)
        .in("id", batchIds);
    }
    await supabase.from("campaign_activity").insert(
      affectedIds.map((campaignId) => ({
        user_id: userId,
        campaign_id: campaignId,
        event_type: "batch_paused_provider_limit",
        metadata: { reason, message },
      })),
    );
  }

  // Do not clear in-flight claims here. A Gmail request may have succeeded
  // immediately before another row hit a quota/auth error; releasing every
  // claim would allow that accepted message to be sent twice.
}

async function finalizeCampaignBatches(
  supabase: AppSupabaseClient,
  userId: string,
  campaignBatchIds: Array<string | null>,
) {
  for (const campaignBatchId of [
    ...new Set(campaignBatchIds.filter((id): id is string => Boolean(id))),
  ]) {
    const [{ data: link }, { count: remaining }, { count: sent }, { count: failed }] =
      await Promise.all([
        supabase
          .from("campaign_batches")
          .select("id, campaign_id, batch_id")
          .eq("id", campaignBatchId)
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("campaign_recipients")
          .select("*", { count: "exact", head: true })
          .eq("campaign_batch_id", campaignBatchId)
          .eq("user_id", userId)
          .in("status", ["pending", "queued", "sending"]),
        supabase
          .from("campaign_recipients")
          .select("*", { count: "exact", head: true })
          .eq("campaign_batch_id", campaignBatchId)
          .eq("user_id", userId)
          .eq("status", "sent"),
        supabase
          .from("campaign_recipients")
          .select("*", { count: "exact", head: true })
          .eq("campaign_batch_id", campaignBatchId)
          .eq("user_id", userId)
          .in("status", ["failed", "bounced"]),
      ]);
    if (!link || (remaining ?? 0) > 0) continue;

    const status = (sent ?? 0) > 0 ? "completed" : "failed";
    const now = new Date().toISOString();
    await Promise.all([
      supabase
        .from("campaign_batches")
        .update({ status, completed_at: now })
        .eq("id", link.id)
        .eq("user_id", userId)
        .in("status", ["processing", "scheduled"]),
      supabase
        .from("contact_batches")
        .update({ status })
        .eq("id", link.batch_id)
        .eq("user_id", userId),
      supabase.from("campaign_activity").insert({
        user_id: userId,
        campaign_id: link.campaign_id,
        campaign_batch_id: link.id,
        event_type: status === "completed" ? "batch_completed" : "batch_failed",
        metadata: { sent: sent ?? 0, failed: failed ?? 0 },
      }),
    ]);
  }
}

async function finalizeFinishedSteps(
  supabase: AppSupabaseClient,
  userId: string,
  campaignId: string,
  stepIds: string[],
) {
  for (const stepId of [...new Set(stepIds)]) {
    const [{ count: remaining }, { count: accepted }, { count: failed }] =
      await Promise.all([
        supabase
          .from("campaign_recipients")
          .select("*", { count: "exact", head: true })
          .eq("campaign_step_id", stepId)
          .eq("user_id", userId)
          .in("status", ["pending", "queued", "sending"]),
        supabase
          .from("campaign_recipients")
          .select("*", { count: "exact", head: true })
          .eq("campaign_step_id", stepId)
          .eq("user_id", userId)
          .eq("status", "sent"),
        supabase
          .from("campaign_recipients")
          .select("*", { count: "exact", head: true })
          .eq("campaign_step_id", stepId)
          .eq("user_id", userId)
          .in("status", ["failed", "bounced"]),
      ]);

    if ((remaining ?? 0) > 0) continue;

    const status =
      (accepted ?? 0) > 0
        ? "sent"
        : (failed ?? 0) > 0
          ? "failed"
          : "cancelled";
    await supabase
      .from("campaign_steps")
      .update({
        status,
        sent_at: status === "sent" ? new Date().toISOString() : null,
        failed_at: status === "failed" ? new Date().toISOString() : null,
      })
      .eq("id", stepId)
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .in("status", ["sending", "scheduled"]);
  }
}

async function getTerminalCampaignStatus(
  supabase: AppSupabaseClient,
  userId: string,
  campaignId: string,
): Promise<"completed" | "failed"> {
  const [{ count: accepted }, { count: failed }] = await Promise.all([
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .eq("status", "sent"),
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("user_id", userId)
      .in("status", ["failed", "bounced"]),
  ]);
  return (accepted ?? 0) === 0 && (failed ?? 0) > 0
    ? "failed"
    : "completed";
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
  options?: { deadlineAt?: number },
): Promise<QueueBatchResult> {
  const { batchSize, sendDelayMs } = getQueueConfig();
  const shouldStopClaiming = () =>
    Boolean(
      options?.deadlineAt &&
        Date.now() >= options.deadlineAt - STOP_CLAIMING_BEFORE_DEADLINE_MS,
    );

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!campaign) {
    return { error: "Campaign not found." };
  }

  if (
    ["draft", "paused", "cancelled", "failed"].includes(campaign.status)
  ) {
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

  // Credentials are never readable via authenticated RLS — use service role.
  const trusted = getTrustedClient(supabase);
  await recoverExpiredClaims(trusted, userId, campaign.id);
  const automation = await materializeDueAutomatedRecipients(
    trusted,
    userId,
    campaign,
  );

  const nowIso = new Date().toISOString();
  const { data: runnableBatchRows } = await supabase
    .from("campaign_batches")
    .select("id")
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId)
    .or(`status.eq.processing,and(status.eq.scheduled,scheduled_at.lte.${nowIso})`);
  const runnableBatchIds = (runnableBatchRows ?? []).map((row) => row.id);

  let queueQuery = supabase
    .from("campaign_recipients")
    .select("*")
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId)
    .in("status", ["pending", "queued"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`);
  queueQuery =
    runnableBatchIds.length > 0
      ? queueQuery.or(
          `campaign_batch_id.is.null,campaign_batch_id.in.(${runnableBatchIds.join(",")})`,
        )
      : queueQuery.is("campaign_batch_id", null);
  const { data: batch, error: batchError } = await queueQuery
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

    if ((remainingCount ?? 0) === 0 && !automation.hasFutureSteps) {
      const terminalStatus = await getTerminalCampaignStatus(
        supabase,
        userId,
        campaign.id,
      );
      await supabase
        .from("campaigns")
        .update({
          status: terminalStatus,
          completed_at: new Date().toISOString(),
        })
        .eq("id", campaign.id)
        .eq("user_id", userId)
        .in("status", ["sending", "scheduled", "completed"]);

      return { processed: 0, remaining: 0, campaignStatus: terminalStatus };
    }

    await supabase
      .from("campaigns")
      .update({ status: "scheduled", completed_at: null })
      .eq("id", campaign.id)
      .eq("user_id", userId)
      .in("status", ["sending", "scheduled", "completed"]);

    return {
      processed: 0,
      remaining: remainingCount ?? 0,
      campaignStatus: "scheduled",
    };
  }

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

  if (campaign.status !== "sending") {
    await supabase
      .from("campaigns")
      .update({ status: "sending", completed_at: null, pause_reason: null })
      .eq("id", campaign.id)
      .eq("user_id", userId);
  }

  if (runnableBatchIds.length) {
    await supabase
      .from("campaign_batches")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("campaign_id", campaign.id)
      .eq("user_id", userId)
      .in("id", runnableBatchIds)
      .eq("status", "scheduled");
  }

  const contactIds = batch.map((recipient) => recipient.contact_id);
  const stepIds = [...new Set(batch.map((recipient) => recipient.campaign_step_id))];
  const [
    { data: contacts },
    { data: suppressed },
    { data: memberships },
    { data: steps },
    { data: repliedRows },
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, email, email_normalized, status, is_unsubscribed, is_suppressed",
      )
      .eq("user_id", userId)
      .in("id", contactIds),
    supabase
      .from("suppression_list")
      .select("email_normalized")
      .eq("user_id", userId),
    supabase
      .from("campaign_contacts")
      .select("contact_id, removed_at")
      .eq("campaign_id", campaign.id)
      .eq("user_id", userId)
      .in("contact_id", contactIds),
    supabase
      .from("campaign_steps")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("user_id", userId)
      .in("id", stepIds),
    supabase
      .from("campaign_recipients")
      .select("contact_id")
      .eq("campaign_id", campaign.id)
      .eq("user_id", userId)
      .in("contact_id", contactIds)
      .not("replied_at", "is", null),
  ]);

  const contactMap = new Map((contacts ?? []).map((contact) => [contact.id, contact]));
  const suppressedSet = new Set((suppressed ?? []).map((row) => row.email_normalized));
  const activeMembers = new Set(
    (memberships ?? [])
      .filter((membership) => !membership.removed_at)
      .map((membership) => membership.contact_id),
  );
  const stepMap = new Map((steps ?? []).map((step) => [step.id, step]));
  const repliedContacts = new Set(
    (repliedRows ?? []).map((recipient) => recipient.contact_id),
  );
  const provider = resolved.value.provider;

  await supabase
    .from("campaign_steps")
    .update({ status: "sending" })
    .eq("user_id", userId)
    .eq("campaign_id", campaign.id)
    .in("id", stepIds)
    .in("status", ["draft", "scheduled"]);

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let retriesScheduled = 0;

  for (const recipient of batch) {
    if (shouldStopClaiming()) {
      break;
    }

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
    const claimToken = randomUUID();
    const { data: claimed } = await supabase
      .from("campaign_recipients")
      .update({
        status: "sending",
        claimed_at: new Date().toISOString(),
        claim_expires_at: claimExpires,
        claim_token: claimToken,
      })
      .eq("id", recipient.id)
      .eq("user_id", userId)
      .in("status", ["pending", "queued"])
      .select("id, campaign_batch_id, email_account_id")
      .maybeSingle();

    if (!claimed) {
      continue;
    }

    console.info("[QUEUE] Job claimed", {
      jobId: recipient.id,
      campaignId: campaign.id,
      batchId: recipient.campaign_batch_id,
      sendingAccountId: recipient.email_account_id,
    });

    processed++;
    console.info("[QUEUE] Job processing", {
      jobId: recipient.id,
      campaignId: campaign.id,
      batchId: recipient.campaign_batch_id,
      sendingAccountId: recipient.email_account_id,
    });
    const contact = contactMap.get(recipient.contact_id);
    const step = stepMap.get(recipient.campaign_step_id);
    const skipReason = !activeMembers.has(recipient.contact_id)
      ? "removed"
      : repliedContacts.has(recipient.contact_id)
        ? "replied"
        : contact?.status ?? "ineligible";

    if (
      !contact ||
      !step ||
      !activeMembers.has(recipient.contact_id) ||
      (step.step_type === "automated_followup" &&
        step.stop_on_reply &&
        repliedContacts.has(recipient.contact_id)) ||
      contact.status !== "active" ||
      contact.is_unsubscribed ||
      contact.is_suppressed ||
      suppressedSet.has(contact.email_normalized)
    ) {
      await supabase
        .from("campaign_recipients")
        .update({
          status: "skipped",
          last_error: `Recipient skipped: ${skipReason.replaceAll("_", " ")}.`,
          claimed_at: null,
          claim_expires_at: null,
          claim_token: null,
          sequence_stopped_at: new Date().toISOString(),
          sequence_stop_reason: skipReason,
        })
        .eq("id", recipient.id)
        .eq("user_id", userId)
        .eq("claim_token", claimToken);

      await supabase.from("email_events").insert({
        user_id: userId,
        campaign_id: campaign.id,
        campaign_step_id: recipient.campaign_step_id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type: "failed",
        metadata: { reason: skipReason, skipped: true },
      });

      skipped++;
      continue;
    }

    if (step.status === "cancelled" || step.status === "failed") {
      await supabase
        .from("campaign_recipients")
        .update({
          status: "skipped",
          last_error: "Follow-up step is no longer active.",
          claimed_at: null,
          claim_expires_at: null,
          claim_token: null,
        })
        .eq("id", recipient.id)
        .eq("user_id", userId)
        .eq("claim_token", claimToken);
      skipped++;
      continue;
    }

    const unsubscribeUrl = buildUnsubscribeUrl(contact.id);
    let threadId = recipient.provider_thread_id;
    if (!threadId && step.step_type !== "initial") {
      const { data: previousSend } = await supabase
        .from("campaign_recipients")
        .select("provider_thread_id")
        .eq("campaign_id", campaign.id)
        .eq("contact_id", recipient.contact_id)
        .eq("user_id", userId)
        .eq("status", "sent")
        .not("provider_thread_id", "is", null)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      threadId = previousSend?.provider_thread_id ?? null;
    }
    const rendered = renderCampaignEmail({
      subject: subjectForSend(step.subject),
      htmlContent: step.html_content,
      textContent: step.text_content,
      vars: {
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
      },
    });

    console.info("[QUEUE] Gmail request started", {
      jobId: recipient.id,
      campaignId: campaign.id,
      batchId: recipient.campaign_batch_id,
      sendingAccountId: recipient.email_account_id,
    });
    const result = await provider.send({
      to: recipient.to_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      from: resolved.value.email,
      fromName: resolved.value.displayName ?? undefined,
      headers: {
        // Rendered by mail clients as their own unsubscribe control, so the
        // message body stays free of footer text.
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      threadId: threadId ?? undefined,
    });
    console.info("[QUEUE] Gmail request completed", {
      jobId: recipient.id,
      campaignId: campaign.id,
      batchId: recipient.campaign_batch_id,
      sendingAccountId: recipient.email_account_id,
      success: result.success,
      errorCode: result.success ? null : result.errorCode,
    });

    const attemptCount = recipient.attempt_count + 1;

    if (result.success) {
      const { data: finalized } = await supabase
        .from("campaign_recipients")
        .update({
          status: "sent",
          attempt_count: attemptCount,
          sent_at: new Date().toISOString(),
          last_error: null,
          next_attempt_at: null,
          provider_message_id: result.messageId ?? null,
          provider_thread_id:
            result.threadId ?? threadId ?? null,
          claimed_at: null,
          claim_expires_at: null,
          claim_token: null,
        })
        .eq("id", recipient.id)
        .eq("user_id", userId)
        .eq("claim_token", claimToken)
        .eq("status", "sending")
        .select("id")
        .maybeSingle();

      if (!finalized) {
        console.error("[queue-worker] Lost claim before Gmail result finalization", {
          recipientId: recipient.id,
          campaignId: campaign.id,
        });
        continue;
      }

      await supabase.from("email_events").insert({
        user_id: userId,
        campaign_id: campaign.id,
        campaign_step_id: recipient.campaign_step_id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type: "sent",
        provider: result.provider,
        provider_message_id: result.messageId ?? null,
      });
      await supabase.from("campaign_activity").insert({
        user_id: userId,
        campaign_id: campaign.id,
        campaign_step_id: recipient.campaign_step_id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type: "email_sent",
        metadata: {
          provider: result.provider,
          provider_message_id: result.messageId ?? null,
        },
      });

      await trusted
        .from("email_accounts")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", resolved.value.accountId)
        .eq("user_id", userId);

      sent++;
      console.info("[QUEUE] Job completed", {
        jobId: recipient.id,
        campaignId: campaign.id,
        batchId: recipient.campaign_batch_id,
        sendingAccountId: recipient.email_account_id,
      });
    } else if (
      result.errorCode === "auth_required" ||
      result.errorCode === "rate_limited" ||
      result.errorCode === "quota_exceeded" ||
      result.errorCode === "provider_disabled"
    ) {
      const reason =
        result.errorCode === "auth_required"
          ? "auth_required"
          : result.errorCode === "provider_disabled"
            ? "provider_disabled"
            : "rate_limit";
      const message = userFacingEmailError(result.errorCode, result.error);

      await pauseForAccountIssue(
        trusted,
        userId,
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
          claim_token: null,
        })
        .eq("id", recipient.id)
        .eq("user_id", userId)
        .eq("claim_token", claimToken);

      await supabase.from("email_events").insert({
        user_id: userId,
        campaign_id: campaign.id,
        campaign_step_id: recipient.campaign_step_id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type: "retry_scheduled",
        provider: result.provider,
        metadata: { attempt: attemptCount, error: result.error ?? null },
      });

      retriesScheduled++;
      console.info("[QUEUE] Job retry scheduled", {
        jobId: recipient.id,
        campaignId: campaign.id,
        batchId: recipient.campaign_batch_id,
        sendingAccountId: recipient.email_account_id,
        attempt: attemptCount,
      });
    } else {
      await supabase
        .from("campaign_recipients")
        .update({
          status: "failed",
          attempt_count: attemptCount,
          failed_at: new Date().toISOString(),
          delivery_unknown_at:
            result.errorCode === "delivery_unknown"
              ? new Date().toISOString()
              : null,
          last_error:
            userFacingEmailError(result.errorCode, result.error) ||
            "Send failed",
          next_attempt_at: null,
          claimed_at: null,
          claim_expires_at: null,
          claim_token: null,
        })
        .eq("id", recipient.id)
        .eq("user_id", userId)
        .eq("claim_token", claimToken);

      await supabase.from("email_events").insert({
        user_id: userId,
        campaign_id: campaign.id,
        campaign_step_id: recipient.campaign_step_id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type: "failed",
        provider: result.provider,
        metadata: { attempt: attemptCount, error: result.error ?? null },
      });
      await supabase.from("campaign_activity").insert({
        user_id: userId,
        campaign_id: campaign.id,
        campaign_step_id: recipient.campaign_step_id,
        campaign_recipient_id: recipient.id,
        contact_id: recipient.contact_id,
        event_type:
          result.errorCode === "delivery_unknown"
            ? "email_delivery_unknown"
            : "email_failed",
        metadata: {
          attempt: attemptCount,
          error: result.error ?? null,
        },
      });

      failed++;
      console.info("[QUEUE] Job failed", {
        jobId: recipient.id,
        campaignId: campaign.id,
        batchId: recipient.campaign_batch_id,
        sendingAccountId: recipient.email_account_id,
        attempt: attemptCount,
      });
    }

    // No throttle is needed after the final row in this worker slice.
    if (sendDelayMs > 0 && recipient !== batch[batch.length - 1]) {
      await sleep(sendDelayMs);
    }
  }

  await finalizeFinishedSteps(
    trusted,
    userId,
    campaign.id,
    batch.map((recipient) => recipient.campaign_step_id),
  );
  await finalizeCampaignBatches(
    trusted,
    userId,
    batch.map((recipient) => recipient.campaign_batch_id),
  );
  const postSendAutomation = await materializeDueAutomatedRecipients(
    trusted,
    userId,
    campaign,
  );

  const { count: remainingCount } = await supabase
    .from("campaign_recipients")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId)
    .in("status", ["pending", "queued", "sending"]);
  const dueNowIso = new Date().toISOString();
  const { count: dueRemainingCount } = await supabase
    .from("campaign_recipients")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId)
    .in("status", ["pending", "queued"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${dueNowIso}`);

  let campaignStatus = "sending";

  const { data: stillSending } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", campaign.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (stillSending?.status === "paused") {
    campaignStatus = "paused";
  } else if (
    (remainingCount ?? 0) === 0 &&
    !postSendAutomation.hasFutureSteps
  ) {
    const terminalStatus = await getTerminalCampaignStatus(
      supabase,
      userId,
      campaign.id,
    );
    await supabase
      .from("campaigns")
      .update({
        status: terminalStatus,
        completed_at: new Date().toISOString(),
      })
      .eq("id", campaign.id)
      .eq("user_id", userId)
      .eq("status", "sending");
    campaignStatus = terminalStatus;
  } else if ((remainingCount ?? 0) === 0) {
    await supabase
      .from("campaigns")
      .update({ status: "scheduled", completed_at: null })
      .eq("id", campaign.id)
      .eq("user_id", userId)
      .eq("status", "sending");
    campaignStatus = "scheduled";
  } else if ((dueRemainingCount ?? 0) === 0) {
    await supabase
      .from("campaigns")
      .update({ status: "scheduled", completed_at: null })
      .eq("id", campaign.id)
      .eq("user_id", userId)
      .eq("status", "sending");
    campaignStatus = "scheduled";
  }

  console.info("[QUEUE] Batch progress updated", {
    campaignId: campaign.id,
    processed,
    sent,
    failed,
    skipped,
    retriesScheduled,
    remaining: remainingCount ?? 0,
    campaignStatus,
  });

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

export const USER_QUEUE_DRAIN_BUDGET_MS = 8_000;

export type QueueDrainResult = QueueBatchResult & {
  hasMore: boolean;
  campaignId?: string;
};

/**
 * Keeps sending until the time budget is spent or the user's due queue is empty.
 * Used by the signed-in browser pump so sending does not wait on a page refresh.
 */
export async function drainUserEmailQueue(
  supabase: AppSupabaseClient,
  userId: string,
  options?: { campaignId?: string; timeBudgetMs?: number },
): Promise<QueueDrainResult> {
  const startedAt = Date.now();
  const timeBudgetMs = options?.timeBudgetMs ?? USER_QUEUE_DRAIN_BUDGET_MS;
  const deadlineAt = startedAt + timeBudgetMs;
  const nowIso = new Date().toISOString();

  let campaignIds: string[] = [];
  if (options?.campaignId) {
    campaignIds = [options.campaignId];
  } else {
    const { data: dueRows } = await supabase
      .from("campaign_recipients")
      .select("campaign_id")
      .eq("user_id", userId)
      .in("status", ["pending", "queued"])
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
      .limit(80);
    campaignIds = [
      ...new Set((dueRows ?? []).map((row) => row.campaign_id)),
    ];
  }

  const totals: QueueDrainResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    retriesScheduled: 0,
    remaining: 0,
    hasMore: false,
  };

  if (campaignIds.length === 0) {
    return totals;
  }

  let round = [...campaignIds];
  while (
    round.length > 0 &&
    Date.now() < deadlineAt - STOP_CLAIMING_BEFORE_DEADLINE_MS
  ) {
    const nextRound: string[] = [];
    for (const campaignId of round) {
      if (Date.now() >= deadlineAt - STOP_CLAIMING_BEFORE_DEADLINE_MS) {
        totals.hasMore = true;
        break;
      }
      const result = await processCampaignQueueBatch(supabase, userId, campaignId, {
        deadlineAt,
      });
      totals.campaignId = campaignId;
      totals.campaignStatus = result.campaignStatus;
      totals.processed = (totals.processed ?? 0) + (result.processed ?? 0);
      totals.sent = (totals.sent ?? 0) + (result.sent ?? 0);
      totals.failed = (totals.failed ?? 0) + (result.failed ?? 0);
      totals.skipped = (totals.skipped ?? 0) + (result.skipped ?? 0);
      totals.retriesScheduled =
        (totals.retriesScheduled ?? 0) + (result.retriesScheduled ?? 0);
      totals.remaining = result.remaining ?? 0;
      if (result.error) {
        totals.error = result.error;
        continue;
      }
      if ((result.processed ?? 0) > 0 && (result.remaining ?? 0) > 0) {
        nextRound.push(campaignId);
      }
    }
    round = nextRound;
  }

  const dueNowIso = new Date().toISOString();
  const { count: dueRemaining } = await supabase
    .from("campaign_recipients")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["pending", "queued"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${dueNowIso}`);
  totals.hasMore = totals.hasMore || (dueRemaining ?? 0) > 0;
  if (totals.hasMore && (totals.remaining ?? 0) === 0) {
    totals.remaining = dueRemaining ?? 0;
  }

  return totals;
}
