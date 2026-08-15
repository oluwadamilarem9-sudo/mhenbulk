"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  campaignSchema,
  campaignTestEmailSchema,
  subjectForSend,
  subjectForStorage,
  type CampaignActionState,
} from "@/features/campaigns/schemas";
import { getQueueConfig } from "@/lib/env";
import { userFacingEmailError } from "@/lib/email/errors";
import { renderCampaignEmail } from "@/lib/email/render";
import { resolveEmailProviderForAccount } from "@/lib/email/resolve-provider";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { parseContactsFile } from "@/features/contacts/csv";
import { contactSchema } from "@/features/contacts/schemas";

const uuidSchema = z.string().uuid();

type ActivityType =
  | "campaign_created"
  | "contacts_added"
  | "contacts_removed"
  | "campaign_updated"
  | "test_sent"
  | "campaign_launched"
  | "campaign_paused"
  | "campaign_resumed"
  | "campaign_cancelled"
  | "followup_created"
  | "followup_scheduled"
  | "followup_sent"
  | "followup_cancelled"
  | "contact_replied"
  | "automation_updated";

async function writeCampaignActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  campaignId: string,
  eventType: ActivityType,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  await supabase.from("campaign_activity").insert({
    user_id: userId,
    campaign_id: campaignId,
    event_type: eventType,
    metadata,
  });
}

async function syncInitialStep(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  campaign: {
    id: string;
    subject: string;
    htmlContent: string;
    textContent?: string | null;
    emailAccountId: string;
  },
) {
  await supabase.from("campaign_steps").upsert(
    {
      user_id: userId,
      campaign_id: campaign.id,
      step_type: "initial",
      step_number: 1,
      subject: subjectForStorage(campaign.subject),
      html_content: campaign.htmlContent,
      text_content: campaign.textContent || null,
      delay_minutes: 0,
      send_mode: "immediate",
      status: "draft",
      audience_mode: "all_eligible",
      email_account_id: campaign.emailAccountId,
      stop_on_reply: true,
      stop_on_unsubscribe: true,
      stop_on_bounce: true,
    },
    { onConflict: "campaign_id,step_number" },
  );
}

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
    emailAccountId: formData.get("emailAccountId"),
  });
}

async function loadOwnedSender(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  emailAccountId: string,
) {
  const { data } = await supabase
    .from("email_accounts")
    .select("id, email, display_name, status, provider")
    .eq("id", emailAccountId)
    .eq("user_id", userId)
    .maybeSingle();

  return data;
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

  const sender = await loadOwnedSender(
    supabase,
    user.id,
    parsed.data.emailAccountId,
  );

  if (!sender || sender.provider !== "gmail") {
    return { error: "Gmail is not connected." };
  }

  if (sender.status === "needs_reauth" || sender.status === "disconnected") {
    return {
      error: "Your Gmail connection needs to be reauthorized.",
    };
  }

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      subject: subjectForStorage(parsed.data.subject),
      html_content: parsed.data.htmlContent,
      text_content: parsed.data.textContent || null,
      email_account_id: sender.id,
      from_email: sender.email,
      from_name: sender.display_name,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: "Unable to create the campaign. Please try again." };
  }

  await syncInitialStep(supabase, user.id, {
    id: data.id,
    subject: parsed.data.subject ?? "",
    htmlContent: parsed.data.htmlContent,
    textContent: parsed.data.textContent,
    emailAccountId: sender.id,
  });
  await writeCampaignActivity(
    supabase,
    user.id,
    data.id,
    "campaign_created",
  );
  const selectedIds = z
    .array(uuidSchema)
    .max(500)
    .safeParse(formData.getAll("contactIds"));
  if (selectedIds.success && selectedIds.data.length > 0) {
    const ownedContacts: { id: string }[] = [];
    for (let index = 0; index < selectedIds.data.length; index += 250) {
      const { data: owned } = await supabase
        .from("contacts")
        .select("id")
        .eq("user_id", user.id)
        .eq("is_unsubscribed", false)
        .eq("is_suppressed", false)
        .in("id", selectedIds.data.slice(index, index + 250));
      ownedContacts.push(...(owned ?? []));
    }
    if (ownedContacts.length) {
      await supabase.from("campaign_contacts").upsert(
        ownedContacts.map((contact) => ({
          user_id: user.id,
          campaign_id: data.id,
          contact_id: contact.id,
          removed_at: null,
        })),
        { onConflict: "campaign_id,contact_id" },
      );
      await writeCampaignActivity(
        supabase,
        user.id,
        data.id,
        "contacts_added",
        { count: ownedContacts.length, source: "campaign_builder" },
      );
    }
  }

  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  redirect(`/campaigns/${data.id}?tab=recipients`);
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

  const sender = await loadOwnedSender(
    supabase,
    user.id,
    parsed.data.emailAccountId,
  );

  if (!sender || sender.provider !== "gmail") {
    return { error: "Gmail is not connected." };
  }

  if (sender.status === "needs_reauth" || sender.status === "disconnected") {
    return {
      error: "Your Gmail connection needs to be reauthorized.",
    };
  }

  const { data: updated, error } = await supabase
    .from("campaigns")
    .update({
      name: parsed.data.name,
      subject: subjectForStorage(parsed.data.subject),
      html_content: parsed.data.htmlContent,
      text_content: parsed.data.textContent || null,
      email_account_id: sender.id,
      from_email: sender.email,
      from_name: sender.display_name,
    })
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: "Unable to update the campaign. Please try again." };
  }

  if (!updated) {
    return { error: "Only draft campaigns can be edited." };
  }

  await syncInitialStep(supabase, user.id, {
    id: idResult.data,
    subject: parsed.data.subject ?? "",
    htmlContent: parsed.data.htmlContent,
    textContent: parsed.data.textContent,
    emailAccountId: sender.id,
  });
  await writeCampaignActivity(
    supabase,
    user.id,
    idResult.data,
    "campaign_updated",
  );

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${idResult.data}`);
  return { success: "Campaign updated.", campaignId: idResult.data };
}

export async function deleteCampaignAction(
  campaignId: string,
): Promise<CampaignActionState> {
  const idResult = uuidSchema.safeParse(campaignId);
  if (!idResult.success) {
    return { error: "Invalid campaign reference." };
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

  if (existing.status === "sending") {
    return {
      error: "Cancel or pause the campaign before deleting it.",
    };
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

export async function sendTestEmailAction(
  _prev: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const parsed = campaignTestEmailSchema.safeParse({
    campaignId: formData.get("campaignId"),
    to: formData.get("to"),
  });

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

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", parsed.data.campaignId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!campaign) {
    return { error: "Campaign not found." };
  }

  if (!campaign.email_account_id) {
    return {
      error:
        "This campaign has no sending account. Select a connected Gmail account first.",
    };
  }

  let service;
  try {
    service = createServiceRoleClient();
  } catch {
    return {
      error:
        "Server is missing SUPABASE_SERVICE_ROLE_KEY required for Gmail sending.",
    };
  }

  const resolved = await resolveEmailProviderForAccount(
    service,
    user.id,
    campaign.email_account_id,
  );

  if (!resolved.ok) {
    return { error: resolved.error };
  }

  const sendSubject = subjectForSend(campaign.subject);
  const rendered = renderCampaignEmail({
    subject: sendSubject ? `[TEST] ${sendSubject}` : "[TEST]",
    htmlContent: campaign.html_content,
    textContent: campaign.text_content,
    vars: {
      first_name: "Test",
      last_name: "Recipient",
      email: parsed.data.to,
    },
  });

  const result = await resolved.value.provider.send({
    to: parsed.data.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    from: resolved.value.email,
    fromName: resolved.value.displayName ?? undefined,
  });

  if (!result.success) {
    return {
      error: userFacingEmailError(result.errorCode, result.error),
    };
  }

  await service
    .from("email_accounts")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", resolved.value.accountId)
    .eq("user_id", user.id);

  await writeCampaignActivity(
    supabase,
    user.id,
    campaign.id,
    "test_sent",
    { to: parsed.data.to },
  );

  return {
    success: `Test email sent to ${parsed.data.to} from ${resolved.value.email}.`,
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
    .select("id, status, email_account_id")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!campaign) {
    return { error: "Campaign not found." };
  }

  if (campaign.status !== "draft") {
    return { error: "This campaign has already been started." };
  }

  if (!campaign.email_account_id) {
    return {
      error:
        "This campaign has no sending account. Select a connected Gmail account first.",
    };
  }

  const sender = await loadOwnedSender(
    supabase,
    user.id,
    campaign.email_account_id,
  );

  if (!sender || sender.provider !== "gmail") {
    return { error: "Gmail is not connected." };
  }

  if (sender.status === "needs_reauth" || sender.status === "disconnected") {
    return {
      error: "Your Gmail connection needs to be reauthorized.",
    };
  }

  if (
    sender.status === "rate_limited"
  ) {
    return {
      error: "Gmail sending quota was reached. Please try again later.",
    };
  }

  const { data: memberships } = await supabase
    .from("campaign_contacts")
    .select("contact_id")
    .eq("campaign_id", campaign.id)
    .eq("user_id", user.id)
    .is("removed_at", null);

  const enrolledIds = (memberships ?? []).map((membership) => membership.contact_id);
  const requestedIds =
    enrolledIds.length > 0
      ? enrolledIds
      : contactIds === "all"
        ? null
        : contactIds;

  type LaunchContact = {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    email_normalized: string;
  };
  const contacts: LaunchContact[] = [];
  let contactsError: { message: string } | null = null;
  const idChunks = requestedIds
    ? Array.from(
        { length: Math.ceil(requestedIds.length / 250) },
        (_, index) => requestedIds.slice(index * 250, index * 250 + 250),
      )
    : [null];
  for (const idChunk of idChunks) {
    let query = supabase
      .from("contacts")
      .select("id, first_name, last_name, email, email_normalized")
      .eq("user_id", user.id)
      .eq("is_unsubscribed", false)
      .eq("is_suppressed", false);
    if (idChunk) query = query.in("id", idChunk);
    const result = await query;
    if (result.error) {
      contactsError = result.error;
      break;
    }
    contacts.push(...(result.data ?? []));
  }

  if (contactsError) return { error: "Unable to load contacts for this campaign." };

  if (contacts.length === 0) {
    return { error: "No eligible (subscribed) contacts to send to." };
  }

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

  // Persist legacy/all-contact launches into the campaign audience so every
  // queued row has an active enrollment that later follow-ups can reuse.
  await supabase.from("campaign_contacts").upsert(
    eligible.map((contact) => ({
      user_id: user.id,
      campaign_id: campaign.id,
      contact_id: contact.id,
      removed_at: null,
    })),
    { onConflict: "campaign_id,contact_id" },
  );

  const { data: initialStep } = await supabase
    .from("campaign_steps")
    .select("id")
    .eq("campaign_id", campaign.id)
    .eq("user_id", user.id)
    .eq("step_type", "initial")
    .order("step_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!initialStep) {
    return { error: "This campaign is missing its initial sequence step. Save it once, then retry." };
  }

  const { maxRetries } = getQueueConfig();

  const recipients = eligible.map((contact) => ({
    campaign_id: campaign.id,
    contact_id: contact.id,
    user_id: user.id,
    email: contact.email,
    to_email: contact.email,
    to_name: `${contact.first_name} ${contact.last_name}`.trim(),
    status: "queued" as const,
    queued_at: new Date().toISOString(),
    max_attempts: maxRetries,
    campaign_step_id: initialStep.id,
  }));

  const CHUNK_SIZE = 500;
  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const chunk = recipients.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("campaign_recipients")
      .upsert(chunk, { onConflict: "campaign_step_id,contact_id", ignoreDuplicates: true });

    if (error) {
      return { error: "Unable to queue campaign recipients. Please try again." };
    }
  }

  const { data: started, error: statusError } = await supabase
    .from("campaigns")
    .update({
      status: "sending",
      started_at: new Date().toISOString(),
      pause_reason: null,
      from_email: sender.email,
      from_name: sender.display_name,
    })
    .eq("id", campaign.id)
    .eq("user_id", user.id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (statusError) {
    return { error: "Recipients were queued but the campaign could not be started." };
  }
  if (!started) {
    const { data: current } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", campaign.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (current?.status !== "sending") {
      return { error: "Campaign state changed before it could be started. Refresh and retry." };
    }
  }

  await supabase
    .from("campaign_steps")
    .update({ status: "sending" })
    .eq("id", initialStep.id)
    .eq("user_id", user.id);

  await supabase.from("email_events").insert({
    user_id: user.id,
    campaign_id: campaign.id,
    campaign_step_id: initialStep.id,
    event_type: "queued",
    metadata: { recipients: eligible.length, provider: "gmail" },
  });
  await writeCampaignActivity(
    supabase,
    user.id,
    campaign.id,
    "campaign_launched",
    { recipients: eligible.length },
  );

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
    .select("id, status, email_account_id, pause_reason")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!campaign) {
    return { error: "Campaign not found." };
  }

  if (paused && !["sending", "scheduled"].includes(campaign.status)) {
    return { error: "Only sending or scheduled campaigns can be paused." };
  }

  if (!paused && campaign.status !== "paused") {
    return { error: "Only paused campaigns can be resumed." };
  }

  if (!paused && campaign.email_account_id) {
    const sender = await loadOwnedSender(
      supabase,
      user.id,
      campaign.email_account_id,
    );

    if (!sender || sender.status === "needs_reauth" || sender.status === "disconnected") {
      return {
        error: "Your Gmail connection needs to be reauthorized.",
      };
    }

    if (sender.status === "rate_limited") {
      return {
        error: "Gmail sending quota was reached. The campaign cannot resume yet.",
      };
    }
  }

  const { error } = await supabase
    .from("campaigns")
    .update(
      paused
        ? {
            status: "paused",
            paused_at: new Date().toISOString(),
            pause_reason: "manual",
          }
        : {
            status: "sending",
            paused_at: null,
            pause_reason: null,
          },
    )
    .eq("id", campaign.id)
    .eq("user_id", user.id);

  if (error) {
    return { error: paused ? "Unable to pause the campaign." : "Unable to resume the campaign." };
  }

  await writeCampaignActivity(
    supabase,
    user.id,
    campaign.id,
    paused ? "campaign_paused" : "campaign_resumed",
  );

  revalidatePath(`/campaigns/${campaign.id}`);
  revalidatePath("/campaigns");
  return { success: paused ? "Campaign paused." : "Campaign resumed." };
}

export async function cancelCampaignAction(
  campaignId: string,
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

  if (!["sending", "scheduled", "paused"].includes(campaign.status)) {
    return { error: "Only sending, scheduled, or paused campaigns can be cancelled." };
  }

  const { error } = await supabase
    .from("campaigns")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      pause_reason: null,
    })
    .eq("id", campaign.id)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Unable to cancel the campaign." };
  }

  await supabase
    .from("campaign_recipients")
    .update({
      status: "skipped",
      last_error: "Campaign cancelled",
      next_attempt_at: null,
    })
    .eq("campaign_id", campaign.id)
    .eq("user_id", user.id)
    .in("status", ["pending", "queued"]);

  await writeCampaignActivity(
    supabase,
    user.id,
    campaign.id,
    "campaign_cancelled",
  );

  revalidatePath(`/campaigns/${campaign.id}`);
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  return { success: "Campaign cancelled. Remaining queued emails were skipped." };
}

const campaignContactIdsSchema = z.object({
  campaignId: uuidSchema,
  contactIds: z.array(uuidSchema).min(1).max(5000),
});

async function requireOwnedCampaign(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  campaignId: string,
) {
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function enrollCampaignContactsAction(
  campaignId: string,
  contactIds: string[],
): Promise<CampaignActionState> {
  const parsed = campaignContactIdsSchema.safeParse({ campaignId, contactIds });
  if (!parsed.success) return { error: "Select at least one valid contact." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const campaign = await requireOwnedCampaign(supabase, user.id, parsed.data.campaignId);
  if (!campaign) return { error: "Campaign not found." };
  if (campaign.status !== "draft") {
    return { error: "Recipients can only be added before the campaign starts." };
  }

  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_unsubscribed", false)
    .eq("is_suppressed", false)
    .in("id", [...new Set(parsed.data.contactIds)]);
  if (contactsError || !contacts?.length) {
    return { error: "No eligible contacts were selected." };
  }

  const rows = contacts.map((contact) => ({
    user_id: user.id,
    campaign_id: campaign.id,
    contact_id: contact.id,
    removed_at: null,
  }));
  const { error } = await supabase
    .from("campaign_contacts")
    .upsert(rows, { onConflict: "campaign_id,contact_id" });
  if (error) return { error: "Unable to add recipients to this campaign." };

  await writeCampaignActivity(supabase, user.id, campaign.id, "contacts_added", {
    count: rows.length,
  });
  revalidatePath(`/campaigns/${campaign.id}`);
  return { success: `${rows.length} contact${rows.length === 1 ? "" : "s"} added.` };
}

export async function addAndEnrollContactAction(
  _prev: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const campaignId = uuidSchema.safeParse(formData.get("campaignId"));
  const contact = contactSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
  });
  if (!campaignId.success || !contact.success) {
    return {
      error: "Please enter a valid name and email.",
      fieldErrors: contact.success ? undefined : contact.error.flatten().fieldErrors,
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const campaign = await requireOwnedCampaign(supabase, user.id, campaignId.data);
  if (!campaign || campaign.status !== "draft") {
    return { error: "Recipients can only be added to a draft campaign." };
  }

  const { data: saved, error } = await supabase
    .from("contacts")
    .upsert(
      {
        user_id: user.id,
        first_name: contact.data.firstName,
        last_name: contact.data.lastName,
        email: contact.data.email,
      },
      { onConflict: "user_id,email_normalized" },
    )
    .select("id, is_unsubscribed, is_suppressed")
    .single();
  if (error || !saved) return { error: "Unable to save this contact." };
  if (saved.is_unsubscribed || saved.is_suppressed) {
    return { error: "This contact is unsubscribed or suppressed and cannot be enrolled." };
  }

  return enrollCampaignContactsAction(campaign.id, [saved.id]);
}

export async function importAndEnrollCampaignContactsAction(
  formData: FormData,
): Promise<CampaignActionState> {
  const campaignId = uuidSchema.safeParse(formData.get("campaignId"));
  const file = formData.get("file");
  if (!campaignId.success || !(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV, TXT, or TSV contact file." };
  }
  if (file.size > 2 * 1024 * 1024) return { error: "Contact files must be 2 MB or smaller." };

  const { rows, error: parseError } = parseContactsFile(await file.text(), file.name);
  if (parseError) return { error: parseError };
  if (rows.length > 5000) return { error: "Imports are limited to 5,000 rows." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const campaign = await requireOwnedCampaign(supabase, user.id, campaignId.data);
  if (!campaign || campaign.status !== "draft") {
    return { error: "Recipients can only be imported into a draft campaign." };
  }

  const contacts = rows.flatMap((row) => {
    const parsed = contactSchema.safeParse({
      firstName: row.first_name || "Unknown",
      lastName: row.last_name || "Unknown",
      email: row.email,
    });
    return parsed.success
      ? [{
          user_id: user.id,
          first_name: parsed.data.firstName,
          last_name: parsed.data.lastName,
          email: parsed.data.email,
        }]
      : [];
  });
  if (!contacts.length) return { error: "No valid contacts were found in the file." };

  for (let index = 0; index < contacts.length; index += 500) {
    const { error: upsertError } = await supabase
      .from("contacts")
      .upsert(contacts.slice(index, index + 500), {
        onConflict: "user_id,email_normalized",
        ignoreDuplicates: true,
      });
    if (upsertError) return { error: "Unable to import contacts." };
  }

  const emails = [...new Set(contacts.map((contact) => contact.email.toLowerCase()))];
  const savedIds: string[] = [];
  for (let index = 0; index < emails.length; index += 250) {
    const { data: saved } = await supabase
      .from("contacts")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_unsubscribed", false)
      .eq("is_suppressed", false)
      .in("email_normalized", emails.slice(index, index + 250));
    savedIds.push(...(saved ?? []).map((contact) => contact.id));
  }
  if (!savedIds.length) return { error: "Imported contacts are not eligible for enrollment." };
  return enrollCampaignContactsAction(campaign.id, savedIds);
}

export async function removeCampaignContactAction(
  campaignId: string,
  contactId: string,
): Promise<CampaignActionState> {
  const parsed = campaignContactIdsSchema.safeParse({ campaignId, contactIds: [contactId] });
  if (!parsed.success) return { error: "Invalid recipient reference." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const campaign = await requireOwnedCampaign(supabase, user.id, campaignId);
  if (!campaign) return { error: "Campaign not found." };

  const { error } = await supabase
    .from("campaign_contacts")
    .update({ removed_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("contact_id", contactId)
    .eq("user_id", user.id)
    .is("removed_at", null);
  if (error) return { error: "Unable to remove this recipient." };
  const removedAt = new Date().toISOString();
  await supabase
    .from("campaign_recipients")
    .update({
      status: "skipped",
      next_attempt_at: null,
      sequence_stopped_at: removedAt,
      sequence_stop_reason: "removed",
      last_error: "Removed from campaign",
    })
    .eq("campaign_id", campaignId)
    .eq("contact_id", contactId)
    .eq("user_id", user.id)
    .in("status", ["pending", "queued"]);
  await writeCampaignActivity(supabase, user.id, campaignId, "contacts_removed", { count: 1 });
  revalidatePath(`/campaigns/${campaignId}`);
  return { success: "Recipient removed from this campaign." };
}

export async function setCampaignAutomationAction(
  campaignId: string,
  enabled: boolean,
): Promise<CampaignActionState> {
  const id = uuidSchema.safeParse(campaignId);
  if (!id.success) return { error: "Invalid campaign reference." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const { data: existing } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing) return { error: "Campaign not found." };
  let hasQueuedWork = false;
  if (!enabled && existing.status === "scheduled") {
    const { count } = await supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", id.data)
      .eq("user_id", user.id)
      .in("status", ["pending", "queued", "sending"]);
    hasQueuedWork = (count ?? 0) > 0;
  }

  const { data, error } = await supabase
    .from("campaigns")
    .update({
      automation_enabled: enabled,
      ...(enabled && existing.status === "completed"
        ? { status: "scheduled" as const, completed_at: null }
        : !enabled && existing.status === "scheduled" && !hasQueuedWork
          ? { status: "completed" as const, completed_at: new Date().toISOString() }
          : {}),
    })
    .eq("id", id.data)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "Unable to update campaign automation." };
  await writeCampaignActivity(supabase, user.id, id.data, "automation_updated", { enabled });
  revalidatePath(`/campaigns/${id.data}`);
  return { success: `Automation ${enabled ? "enabled" : "disabled"}.` };
}

const followupSchema = z.object({
  campaignId: uuidSchema,
  stepType: z.enum(["manual_followup", "automated_followup"]),
  subject: z.string().trim().max(300),
  htmlContent: z.string().trim().min(1).max(200_000),
  textContent: z.string().trim().max(100_000).optional(),
  delayDays: z.coerce.number().int().min(0).max(365),
  sendMode: z.enum(["immediate", "scheduled", "automated"]),
  scheduledAt: z.string().optional(),
  timezone: z.string().trim().min(1).max(100),
  audienceMode: z.enum(["all_eligible", "not_replied", "custom"]),
  contactIds: z.array(uuidSchema).max(5000),
  stopOnReply: z.boolean(),
  stopOnUnsubscribe: z.boolean(),
  stopOnBounce: z.boolean(),
});

export async function saveFollowupAction(
  _prev: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const parsed = followupSchema.safeParse({
    campaignId: formData.get("campaignId"),
    stepType: formData.get("stepType"),
    subject: formData.get("subject") ?? "",
    htmlContent: formData.get("htmlContent"),
    textContent: formData.get("textContent") ?? "",
    delayDays: formData.get("delayDays") ?? 0,
    sendMode: formData.get("sendMode"),
    scheduledAt: formData.get("scheduledAt")?.toString() || undefined,
    timezone: formData.get("timezone") || "UTC",
    audienceMode: formData.get("audienceMode"),
    contactIds: formData.getAll("contactIds"),
    stopOnReply: formData.get("stopOnReply") === "on",
    stopOnUnsubscribe: formData.get("stopOnUnsubscribe") === "on",
    stopOnBounce: formData.get("stopOnBounce") === "on",
  });
  if (!parsed.success) {
    return { error: "Please complete the follow-up details.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  if (parsed.data.stepType === "manual_followup" && parsed.data.sendMode === "automated") {
    return { error: "Manual follow-ups must be sent now or scheduled." };
  }
  if (parsed.data.stepType === "automated_followup" && parsed.data.sendMode !== "automated") {
    return { error: "Automated follow-ups use a delay after the previous step." };
  }
  const scheduledAt =
    parsed.data.sendMode === "scheduled" ? new Date(parsed.data.scheduledAt ?? "") : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    return { error: "Choose a valid scheduled date and time." };
  }
  if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
    return { error: "Scheduled follow-ups must be in the future." };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const campaign = await requireOwnedCampaign(supabase, user.id, parsed.data.campaignId);
  if (!campaign) return { error: "Campaign not found." };
  if (!campaign.email_account_id) return { error: "Connect a Gmail sender first." };
  if (
    parsed.data.stepType === "manual_followup" &&
    !["completed", "scheduled"].includes(campaign.status)
  ) {
    return { error: "Manual follow-ups are available after the campaign is sent." };
  }

  const { data: latest } = await supabase
    .from("campaign_steps")
    .select("step_number")
    .eq("campaign_id", campaign.id)
    .eq("user_id", user.id)
    .order("step_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const stepNumber = (latest?.step_number ?? 1) + 1;
  const stepStatus =
    parsed.data.sendMode === "immediate"
      ? "sending"
      : parsed.data.sendMode === "scheduled"
        ? "scheduled"
        : "draft";
  const { data: step, error: stepError } = await supabase
    .from("campaign_steps")
    .insert({
      user_id: user.id,
      campaign_id: campaign.id,
      step_type: parsed.data.stepType,
      step_number: stepNumber,
      subject: subjectForStorage(parsed.data.subject),
      html_content: parsed.data.htmlContent,
      text_content: parsed.data.textContent || null,
      delay_minutes: parsed.data.delayDays * 24 * 60,
      send_mode: parsed.data.sendMode,
      status: stepStatus,
      scheduled_at: scheduledAt?.toISOString() ?? null,
      timezone: parsed.data.timezone,
      audience_mode: parsed.data.audienceMode,
      target_contact_ids:
        parsed.data.audienceMode === "custom" ? parsed.data.contactIds : [],
      email_account_id: campaign.email_account_id,
      stop_on_reply: parsed.data.stopOnReply,
      stop_on_unsubscribe: parsed.data.stopOnUnsubscribe,
      stop_on_bounce: parsed.data.stopOnBounce,
    })
    .select("id")
    .single();
  if (stepError || !step) return { error: "Unable to save this follow-up." };

  if (parsed.data.stepType === "manual_followup") {
    const { data: memberships } = await supabase
      .from("campaign_contacts")
      .select("contact_id, contacts!inner(id, first_name, last_name, email, email_normalized, is_unsubscribed, is_suppressed)")
      .eq("campaign_id", campaign.id)
      .eq("user_id", user.id)
      .is("removed_at", null);
    const custom = new Set(parsed.data.contactIds);
    const { data: replied } = await supabase
      .from("campaign_recipients")
      .select("contact_id")
      .eq("campaign_id", campaign.id)
      .eq("user_id", user.id)
      .not("replied_at", "is", null);
    const repliedIds = new Set((replied ?? []).map((row) => row.contact_id));
    const { data: suppressedRows } = await supabase
      .from("suppression_list")
      .select("email_normalized")
      .eq("user_id", user.id);
    const suppressedEmails = new Set(
      (suppressedRows ?? []).map((row) => row.email_normalized),
    );
    const selected = (memberships ?? []).filter((membership) => {
      const contact = Array.isArray(membership.contacts) ? membership.contacts[0] : membership.contacts;
      if (
        !contact ||
        contact.is_unsubscribed ||
        contact.is_suppressed ||
        suppressedEmails.has(contact.email_normalized)
      ) {
        return false;
      }
      if (parsed.data.audienceMode === "custom" && !custom.has(membership.contact_id)) return false;
      return parsed.data.audienceMode !== "not_replied" || !repliedIds.has(membership.contact_id);
    });
    if (!selected.length) {
      await supabase.from("campaign_steps").delete().eq("id", step.id).eq("user_id", user.id);
      return { error: "No enrolled recipients match this audience." };
    }
    const { maxRetries } = getQueueConfig();
    const queueTime = scheduledAt?.toISOString() ?? new Date().toISOString();
    const recipients = selected.map((membership) => {
      const contact = Array.isArray(membership.contacts) ? membership.contacts[0] : membership.contacts;
      return {
        campaign_id: campaign.id,
        campaign_step_id: step.id,
        contact_id: membership.contact_id,
        user_id: user.id,
        email: contact!.email,
        to_email: contact!.email,
        to_name: `${contact!.first_name} ${contact!.last_name}`.trim(),
        status: "queued" as const,
        queued_at: new Date().toISOString(),
        next_attempt_at: parsed.data.sendMode === "scheduled" ? queueTime : null,
        max_attempts: maxRetries,
      };
    });
    const { error: queueError } = await supabase
      .from("campaign_recipients")
      .upsert(recipients, { onConflict: "campaign_step_id,contact_id", ignoreDuplicates: true });
    if (queueError) {
      await supabase
        .from("campaign_steps")
        .delete()
        .eq("id", step.id)
        .eq("user_id", user.id);
      return { error: "The follow-up could not be queued. Please try again." };
    }
    await supabase
      .from("campaigns")
      .update({
        status: parsed.data.sendMode === "scheduled" ? "scheduled" : "sending",
        completed_at: null,
        pause_reason: null,
      })
      .eq("id", campaign.id)
      .eq("user_id", user.id);
    await writeCampaignActivity(
      supabase,
      user.id,
      campaign.id,
      parsed.data.sendMode === "scheduled" ? "followup_scheduled" : "followup_sent",
      { step_number: stepNumber, recipients: recipients.length },
    );
  } else {
    await writeCampaignActivity(supabase, user.id, campaign.id, "followup_created", {
      step_number: stepNumber,
      automated: true,
    });
  }

  revalidatePath(`/campaigns/${campaign.id}`);
  return { success: parsed.data.stepType === "automated_followup" ? "Automated step added." : "Follow-up queued." };
}

export async function cancelFollowupAction(
  campaignId: string,
  stepId: string,
): Promise<CampaignActionState> {
  if (!uuidSchema.safeParse(campaignId).success || !uuidSchema.safeParse(stepId).success) {
    return { error: "Invalid follow-up reference." };
  }
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const { data: step } = await supabase
    .from("campaign_steps")
    .update({ status: "cancelled" })
    .eq("id", stepId)
    .eq("campaign_id", campaignId)
    .eq("user_id", user.id)
    .in("status", ["draft", "scheduled"])
    .select("id")
    .maybeSingle();
  if (!step) return { error: "Only draft or scheduled follow-ups can be cancelled." };
  await supabase
    .from("campaign_recipients")
    .update({ status: "skipped", next_attempt_at: null, last_error: "Follow-up cancelled" })
    .eq("campaign_step_id", step.id)
    .eq("user_id", user.id)
    .in("status", ["pending", "queued"]);
  await writeCampaignActivity(supabase, user.id, campaignId, "followup_cancelled");
  revalidatePath(`/campaigns/${campaignId}`);
  return { success: "Follow-up cancelled." };
}

export async function markCampaignRecipientRepliedAction(
  recipientId: string,
): Promise<CampaignActionState> {
  const id = uuidSchema.safeParse(recipientId);
  if (!id.success) return { error: "Invalid recipient reference." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const { data: recipient } = await supabase
    .from("campaign_recipients")
    .select("id, campaign_id, contact_id, status")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!recipient || recipient.status !== "sent") {
    return { error: "Only sent recipients can be marked as replied." };
  }
  const now = new Date().toISOString();
  await supabase
    .from("campaign_recipients")
    .update({
      replied_at: now,
      reply_source: "manual",
      sequence_stopped_at: now,
      sequence_stop_reason: "replied",
    })
    .eq("campaign_id", recipient.campaign_id)
    .eq("contact_id", recipient.contact_id)
    .eq("user_id", user.id);

  const { data: automatedSteps } = await supabase
    .from("campaign_steps")
    .select("id")
    .eq("campaign_id", recipient.campaign_id)
    .eq("user_id", user.id)
    .eq("step_type", "automated_followup")
    .eq("stop_on_reply", true);
  const stepIds = (automatedSteps ?? []).map((step) => step.id);
  if (stepIds.length) {
    await supabase
      .from("campaign_recipients")
      .update({
        status: "skipped",
        next_attempt_at: null,
        sequence_stopped_at: now,
        sequence_stop_reason: "replied",
        last_error: "Sequence stopped: reply marked manually",
      })
      .eq("campaign_id", recipient.campaign_id)
      .eq("contact_id", recipient.contact_id)
      .eq("user_id", user.id)
      .in("campaign_step_id", stepIds)
      .in("status", ["pending", "queued"]);
  }
  await writeCampaignActivity(supabase, user.id, recipient.campaign_id, "contact_replied", {
    contact_id: recipient.contact_id,
    source: "manual",
  });
  revalidatePath(`/campaigns/${recipient.campaign_id}`);
  return { success: "Reply recorded and future automated emails stopped." };
}
