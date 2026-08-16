"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { enrollCampaignContactsAction } from "@/features/campaigns/actions";
import {
  enrollFinderSchema,
  resultIdsSchema,
  type EmailFinderActionState,
} from "@/features/email-finder/schemas";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function setEmailFinderSelectionAction(
  scanId: string,
  resultIds: string[],
  selected: boolean,
): Promise<EmailFinderActionState> {
  const parsed = resultIdsSchema.safeParse({ scanId, resultIds });
  if (!parsed.success) return { error: "Select at least one valid result." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { error } = await supabase
    .from("email_finder_results")
    .update({ selected })
    .eq("user_id", user.id)
    .eq("scan_id", parsed.data.scanId)
    .in("id", parsed.data.resultIds);

  if (error) return { error: "Unable to update selection." };
  revalidatePath("/email-finder");
  return { success: selected ? "Selection updated." : "Selection cleared." };
}

/**
 * Upsert selected finder emails into Contacts without overwriting existing
 * user-entered names/details. Provenance is only written for newly created rows.
 */
export async function addFinderResultsToContactsAction(
  scanId: string,
  resultIds: string[],
): Promise<EmailFinderActionState> {
  const parsed = resultIdsSchema.safeParse({ scanId, resultIds });
  if (!parsed.success) return { error: "Select at least one valid email." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: results, error: resultsError } = await supabase
    .from("email_finder_results")
    .select("id, email, email_normalized, source_url")
    .eq("user_id", user.id)
    .eq("scan_id", parsed.data.scanId)
    .in("id", parsed.data.resultIds);

  if (resultsError || !results?.length) {
    return { error: "No matching scan results were found." };
  }

  const emails = [...new Set(results.map((row) => row.email_normalized))];
  const existingByEmail = new Map<string, { id: string }>();
  for (let index = 0; index < emails.length; index += 250) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("id, email_normalized")
      .eq("user_id", user.id)
      .in("email_normalized", emails.slice(index, index + 250));
    for (const contact of existing ?? []) {
      existingByEmail.set(contact.email_normalized, { id: contact.id });
    }
  }

  let created = 0;
  let existing = 0;
  const now = new Date().toISOString();

  for (const result of results) {
    const already = existingByEmail.get(result.email_normalized);
    if (already) {
      existing += 1;
      await supabase
        .from("email_finder_results")
        .update({
          added_to_contacts: true,
          contact_id: already.id,
          selected: true,
        })
        .eq("id", result.id)
        .eq("user_id", user.id);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("contacts")
      .insert({
        user_id: user.id,
        first_name: "Unknown",
        last_name: "Unknown",
        email: result.email,
        source_type: "email_finder",
        source_url: result.source_url,
        source_result_id: result.id,
        discovered_at: now,
        status: "active",
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      // Race: another request may have inserted the same email.
      const { data: raced } = await supabase
        .from("contacts")
        .select("id")
        .eq("user_id", user.id)
        .eq("email_normalized", result.email_normalized)
        .maybeSingle();
      if (!raced) {
        return { error: "Unable to save one or more contacts." };
      }
      existing += 1;
      await supabase
        .from("email_finder_results")
        .update({
          added_to_contacts: true,
          contact_id: raced.id,
          selected: true,
        })
        .eq("id", result.id)
        .eq("user_id", user.id);
      continue;
    }

    created += 1;
    existingByEmail.set(result.email_normalized, { id: inserted.id });
    await supabase
      .from("email_finder_results")
      .update({
        added_to_contacts: true,
        contact_id: inserted.id,
        selected: true,
      })
      .eq("id", result.id)
      .eq("user_id", user.id);
  }

  revalidatePath("/email-finder");
  revalidatePath("/contacts");
  return {
    success: `${created} contact${created === 1 ? "" : "s"} added${
      existing ? `, ${existing} already in Contacts` : ""
    }.`,
    created,
    existing,
  };
}

export async function addFinderResultsToCampaignAction(
  scanId: string,
  resultIds: string[],
  campaignId: string,
): Promise<EmailFinderActionState> {
  const parsed = enrollFinderSchema.safeParse({ scanId, resultIds, campaignId });
  if (!parsed.success) return { error: "Select emails and a draft campaign." };

  const saved = await addFinderResultsToContactsAction(
    parsed.data.scanId,
    parsed.data.resultIds,
  );
  if (saved.error) return saved;

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: results } = await supabase
    .from("email_finder_results")
    .select("contact_id")
    .eq("user_id", user.id)
    .eq("scan_id", parsed.data.scanId)
    .in("id", parsed.data.resultIds)
    .not("contact_id", "is", null);

  const contactIds = [
    ...new Set(
      (results ?? [])
        .map((row) => row.contact_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  if (!contactIds.length) {
    return { error: "No eligible contacts were available for enrollment." };
  }

  const enrolled = await enrollCampaignContactsAction(
    parsed.data.campaignId,
    contactIds,
  );
  if (enrolled.error) return enrolled;

  revalidatePath(`/campaigns/${parsed.data.campaignId}`);
  return {
    success: enrolled.success ?? "Contacts added to campaign.",
    created: saved.created,
    existing: saved.existing,
    enrolled: contactIds.length,
    campaignId: parsed.data.campaignId,
  };
}

export async function prepareFinderCampaignContactsAction(
  scanId: string,
  resultIds: string[],
): Promise<EmailFinderActionState & { contactIds?: string[] }> {
  const parsed = resultIdsSchema.safeParse({ scanId, resultIds });
  if (!parsed.success) return { error: "Select at least one valid email." };

  const saved = await addFinderResultsToContactsAction(
    parsed.data.scanId,
    parsed.data.resultIds,
  );
  if (saved.error) return saved;

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: results } = await supabase
    .from("email_finder_results")
    .select("contact_id, contacts!inner(id, is_unsubscribed, is_suppressed)")
    .eq("user_id", user.id)
    .eq("scan_id", parsed.data.scanId)
    .in("id", parsed.data.resultIds)
    .not("contact_id", "is", null);

  const contactIds: string[] = [];
  let ineligible = 0;
  for (const row of results ?? []) {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
    if (!contact || contact.is_unsubscribed || contact.is_suppressed) {
      ineligible += 1;
      continue;
    }
    contactIds.push(contact.id);
  }

  if (!contactIds.length) {
    return {
      error: "Selected emails are not eligible for a campaign.",
      ineligible,
    };
  }

  return {
    success: "Contacts ready for campaign.",
    created: saved.created,
    existing: saved.existing,
    contactIds,
    ineligible,
  };
}

export async function markFinderResultsSelectedAction(
  scanId: string,
  resultIds: string[],
): Promise<EmailFinderActionState> {
  const parsed = z
    .object({
      scanId: z.string().uuid(),
      resultIds: z.array(z.string().uuid()).max(500),
    })
    .safeParse({ scanId, resultIds });
  if (!parsed.success) return { error: "Invalid selection." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  await supabase
    .from("email_finder_results")
    .update({ selected: false })
    .eq("user_id", user.id)
    .eq("scan_id", parsed.data.scanId);

  if (parsed.data.resultIds.length) {
    const { error } = await supabase
      .from("email_finder_results")
      .update({ selected: true })
      .eq("user_id", user.id)
      .eq("scan_id", parsed.data.scanId)
      .in("id", parsed.data.resultIds);
    if (error) return { error: "Unable to save selection." };
  }

  revalidatePath("/email-finder");
  return { success: "Selection saved." };
}
