import type { SupabaseClient } from "@supabase/supabase-js";

import { getQueueConfig } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

type AppSupabaseClient = SupabaseClient<Database>;
type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];

type MaterializeResult = {
  created: number;
  hasFutureSteps: boolean;
};

/**
 * Creates queue rows for automated steps only when each recipient's previous
 * step was accepted by Gmail and the configured delay has elapsed.
 */
export async function materializeDueAutomatedRecipients(
  supabase: AppSupabaseClient,
  userId: string,
  campaign: CampaignRow,
): Promise<MaterializeResult> {
  if (!campaign.automation_enabled) {
    return { created: 0, hasFutureSteps: false };
  }

  const { data: steps } = await supabase
    .from("campaign_steps")
    .select("*")
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId)
    .order("step_number", { ascending: true });

  const ordered = steps ?? [];
  const automated = ordered.filter(
    (step) =>
      step.step_type === "automated_followup" &&
      !["sent", "failed", "cancelled"].includes(step.status),
  );

  if (automated.length === 0) {
    return { created: 0, hasFutureSteps: false };
  }

  const { data: memberships } = await supabase
    .from("campaign_contacts")
    .select("contact_id")
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId)
    .is("removed_at", null);

  const memberIds = (memberships ?? []).map((membership) => membership.contact_id);
  if (memberIds.length === 0) {
    // No audience remains, so delayed automated steps can never become due.
    await supabase
      .from("campaign_steps")
      .update({ status: "cancelled" })
      .eq("campaign_id", campaign.id)
      .eq("user_id", userId)
      .eq("step_type", "automated_followup")
      .in("status", ["draft", "scheduled", "sending"]);
    return { created: 0, hasFutureSteps: false };
  }

  const [
    { data: contacts },
    { data: recipientState },
    { data: suppressionRows },
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, email, email_normalized, status, is_unsubscribed, is_suppressed",
      )
      .eq("user_id", userId)
      .in("id", memberIds),
    supabase
      .from("campaign_recipients")
      .select("contact_id, replied_at, sequence_stopped_at, sequence_stop_reason")
      .eq("campaign_id", campaign.id)
      .eq("user_id", userId),
    supabase
      .from("suppression_list")
      .select("email_normalized")
      .eq("user_id", userId),
  ]);

  const contactMap = new Map((contacts ?? []).map((contact) => [contact.id, contact]));
  const repliedContacts = new Set(
    (recipientState ?? [])
      .filter(
        (recipient) =>
          recipient.replied_at || recipient.sequence_stop_reason === "replied",
      )
      .map((recipient) => recipient.contact_id),
  );
  const suppressedEmails = new Set(
    (suppressionRows ?? []).map((row) => row.email_normalized),
  );
  const { maxRetries } = getQueueConfig();
  let created = 0;
  let hasFutureSteps = false;

  for (const step of automated) {
    const previous = [...ordered]
      .reverse()
      .find((candidate) => candidate.step_number < step.step_number);
    if (!previous) continue;

    const [
      { data: previousRecipients },
      { data: existingRecipients },
      { count: previousOpenCount },
    ] =
      await Promise.all([
        supabase
          .from("campaign_recipients")
          .select(
            "contact_id, sent_at, provider_thread_id, sequence_stopped_at, replied_at",
          )
          .eq("campaign_step_id", previous.id)
          .eq("user_id", userId)
          .eq("status", "sent"),
        supabase
          .from("campaign_recipients")
          .select("contact_id, status")
          .eq("campaign_step_id", step.id)
          .eq("user_id", userId),
        supabase
          .from("campaign_recipients")
          .select("*", { count: "exact", head: true })
          .eq("campaign_step_id", previous.id)
          .eq("user_id", userId)
          .in("status", ["pending", "queued", "sending"]),
      ]);

    const existing = new Set(
      (existingRecipients ?? []).map((recipient) => recipient.contact_id),
    );
    const customTargets = new Set(step.target_contact_ids);
    const now = Date.now();
    let waitingForDelay = false;
    const rows: Database["public"]["Tables"]["campaign_recipients"]["Insert"][] =
      [];

    for (const previousRecipient of previousRecipients ?? []) {
      if (existing.has(previousRecipient.contact_id)) continue;
      if (
        step.stop_on_reply &&
        repliedContacts.has(previousRecipient.contact_id)
      ) {
        continue;
      }
      if (!previousRecipient.sent_at) {
        continue;
      }

      const contact = contactMap.get(previousRecipient.contact_id);
      if (
        !contact ||
        contact.status !== "active" ||
        contact.is_unsubscribed ||
        contact.is_suppressed ||
        suppressedEmails.has(contact.email_normalized)
      ) {
        continue;
      }
      if (
        step.audience_mode === "custom" &&
        !customTargets.has(previousRecipient.contact_id)
      ) {
        continue;
      }

      const dueAt =
        new Date(previousRecipient.sent_at).getTime() +
        step.delay_minutes * 60_000;
      if (dueAt > now) {
        waitingForDelay = true;
        continue;
      }

      rows.push({
        campaign_id: campaign.id,
        campaign_step_id: step.id,
        contact_id: contact.id,
        user_id: userId,
        email: contact.email,
        to_email: contact.email,
        to_name: `${contact.first_name} ${contact.last_name}`.trim(),
        status: "queued",
        queued_at: new Date().toISOString(),
        next_attempt_at: null,
        max_attempts: maxRetries,
        provider_thread_id: previousRecipient.provider_thread_id,
      });
    }

    if (rows.length > 0) {
      const { data: inserted } = await supabase
        .from("campaign_recipients")
        .upsert(rows, {
          onConflict: "campaign_step_id,contact_id",
          ignoreDuplicates: true,
        })
        .select("id");
      created += inserted?.length ?? 0;

      await supabase
        .from("campaign_steps")
        .update({ status: "sending" })
        .eq("id", step.id)
        .eq("user_id", userId)
        .in("status", ["draft", "scheduled"]);
    }

    const hasQueuedRows = (existingRecipients ?? []).some((recipient) =>
      ["pending", "queued", "sending"].includes(recipient.status),
    );
    const previousMayStillProduce =
      (previousOpenCount ?? 0) > 0 ||
      !["sent", "failed", "cancelled"].includes(previous.status);

    if (
      rows.length > 0 ||
      hasQueuedRows ||
      waitingForDelay ||
      previousMayStillProduce
    ) {
      hasFutureSteps = true;
    } else {
      await supabase
        .from("campaign_steps")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", step.id)
        .eq("user_id", userId)
        .in("status", ["draft", "scheduled", "sending"]);
    }
  }

  if (created > 0 && campaign.status !== "sending") {
    await supabase
      .from("campaigns")
      .update({ status: "sending", completed_at: null, pause_reason: null })
      .eq("id", campaign.id)
      .eq("user_id", userId);
  }

  return { created, hasFutureSteps };
}
