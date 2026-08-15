"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  campaignSchema,
  campaignTestEmailSchema,
  resolveCampaignSubject,
  type CampaignActionState,
} from "@/features/campaigns/schemas";
import { getQueueConfig } from "@/lib/env";
import { userFacingEmailError } from "@/lib/email/errors";
import { renderCampaignEmail } from "@/lib/email/render";
import { resolveEmailProviderForAccount } from "@/lib/email/resolve-provider";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

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
      subject: resolveCampaignSubject(parsed.data.name, parsed.data.subject),
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
      subject: resolveCampaignSubject(parsed.data.name, parsed.data.subject),
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
    return { error: "Gmail is not connected." };
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

  const rendered = renderCampaignEmail({
    subject: `[TEST] ${campaign.subject}`,
    htmlContent: campaign.html_content,
    textContent: campaign.text_content,
    vars: {
      first_name: "Test",
      last_name: "Recipient",
      email: parsed.data.to,
    },
    unsubscribeUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/unsubscribe?test=1`,
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
    return { error: "Gmail is not connected." };
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

  const { maxRetries } = getQueueConfig();

  const recipients = eligible.map((contact) => ({
    campaign_id: campaign.id,
    contact_id: contact.id,
    user_id: user.id,
    email: contact.email,
    status: "queued" as const,
    queued_at: new Date().toISOString(),
    max_attempts: maxRetries,
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
    .update({
      status: "sending",
      started_at: new Date().toISOString(),
      pause_reason: null,
      from_email: sender.email,
      from_name: sender.display_name,
    })
    .eq("id", campaign.id)
    .eq("user_id", user.id)
    .eq("status", "draft");

  if (statusError) {
    return { error: "Recipients were queued but the campaign could not be started." };
  }

  await supabase.from("email_events").insert({
    user_id: user.id,
    campaign_id: campaign.id,
    event_type: "queued",
    metadata: { recipients: eligible.length, provider: "gmail" },
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
    .select("id, status, email_account_id, pause_reason")
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

  if (campaign.status !== "sending" && campaign.status !== "paused") {
    return { error: "Only sending or paused campaigns can be cancelled." };
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
      claimed_at: null,
      claim_expires_at: null,
    })
    .eq("campaign_id", campaign.id)
    .eq("user_id", user.id)
    .in("status", ["pending", "queued", "sending"]);

  revalidatePath(`/campaigns/${campaign.id}`);
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");
  return { success: "Campaign cancelled. Remaining queued emails were skipped." };
}
