"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { enrollCampaignContactsAction } from "@/features/campaigns/actions";
import {
  MAX_FINDER_SELECTION,
  selectionSchema,
  type EmailFinderActionState,
} from "@/features/email-finder/schemas";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type AppSupabaseClient = SupabaseClient<Database>;

/**
 * Results are addressed either by their scan (single-URL search) or by their
 * batch (bulk website list). Everything below works with both.
 */
type ResultScope = {
  scanId?: string;
  batchId?: string;
};

type FinderResultRecord = {
  id: string;
  scan_id: string;
  email: string;
  email_normalized: string;
  source_url: string;
  category: Database["public"]["Enums"]["email_finder_category"];
};

const SELECT_CHUNK = 250;
const WRITE_CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function applyScope<
  T extends { eq: (column: never, value: never) => T },
>(query: T, scope: ResultScope): T {
  let scoped = query;
  if (scope.scanId) {
    scoped = scoped.eq("scan_id" as never, scope.scanId as never);
  }
  if (scope.batchId) {
    scoped = scoped.eq("batch_id" as never, scope.batchId as never);
  }
  return scoped;
}

async function loadResults(
  supabase: AppSupabaseClient,
  userId: string,
  scope: ResultScope,
  resultIds: string[],
): Promise<FinderResultRecord[]> {
  const records: FinderResultRecord[] = [];

  for (const ids of chunk(resultIds, SELECT_CHUNK)) {
    const query = applyScope(
      supabase
        .from("email_finder_results")
        .select("id, scan_id, email, email_normalized, source_url, category")
        .eq("user_id", userId),
      scope,
    );

    const { data } = await query.in("id", ids);
    records.push(...((data ?? []) as FinderResultRecord[]));
  }

  return records;
}

async function findExistingContactIds(
  supabase: AppSupabaseClient,
  userId: string,
  emails: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const slice of chunk(emails, SELECT_CHUNK)) {
    const { data } = await supabase
      .from("contacts")
      .select("id, email_normalized")
      .eq("user_id", userId)
      .in("email_normalized", slice);

    for (const contact of data ?? []) {
      map.set(contact.email_normalized, contact.id);
    }
  }

  return map;
}

type SaveOutcome = {
  created: number;
  existing: number;
  contactIdsByEmail: Map<string, string>;
  error?: string;
};

/**
 * Adds discovered emails to Contacts without overwriting anything the user
 * already has. Existing rows are reused, and provenance is only written on
 * newly created contacts.
 */
async function saveResultsAsContacts(
  supabase: AppSupabaseClient,
  userId: string,
  scope: ResultScope,
  resultIds: string[],
): Promise<SaveOutcome> {
  const results = await loadResults(supabase, userId, scope, resultIds);
  if (!results.length) {
    return {
      created: 0,
      existing: 0,
      contactIdsByEmail: new Map(),
      error: "No matching scan results were found.",
    };
  }

  const firstResultByEmail = new Map<string, FinderResultRecord>();
  for (const result of results) {
    if (!firstResultByEmail.has(result.email_normalized)) {
      firstResultByEmail.set(result.email_normalized, result);
    }
  }

  const emails = [...firstResultByEmail.keys()];
  const contactIdsByEmail = await findExistingContactIds(supabase, userId, emails);
  const existing = contactIdsByEmail.size;
  const missing = emails.filter((email) => !contactIdsByEmail.has(email));
  const discoveredAt = new Date().toISOString();

  for (const slice of chunk(missing, SELECT_CHUNK)) {
    const rows = slice.map((email) => {
      const result = firstResultByEmail.get(email)!;
      return {
        user_id: userId,
        first_name: "Unknown",
        last_name: "Unknown",
        email: result.email,
        source_type: "email_finder" as const,
        source_url: result.source_url,
        source_result_id: result.id,
        discovered_at: discoveredAt,
        status: "active" as const,
      };
    });

    // ignoreDuplicates keeps any contact the user already edited untouched.
    const { error } = await supabase
      .from("contacts")
      .upsert(rows, {
        onConflict: "user_id,email_normalized",
        ignoreDuplicates: true,
      });

    if (error) {
      return {
        created: 0,
        existing,
        contactIdsByEmail,
        error: "Unable to save one or more contacts.",
      };
    }
  }

  if (missing.length) {
    const inserted = await findExistingContactIds(supabase, userId, missing);
    for (const [email, id] of inserted) contactIdsByEmail.set(email, id);
  }

  const updates = results
    .map((result) => {
      const contactId = contactIdsByEmail.get(result.email_normalized);
      if (!contactId) return null;
      return {
        id: result.id,
        user_id: userId,
        scan_id: result.scan_id,
        email: result.email,
        source_url: result.source_url,
        category: result.category,
        added_to_contacts: true,
        contact_id: contactId,
        selected: true,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  for (const slice of chunk(updates, WRITE_CHUNK)) {
    await supabase.from("email_finder_results").upsert(slice);
  }

  return {
    created: contactIdsByEmail.size - existing,
    existing,
    contactIdsByEmail,
  };
}

async function eligibleContactIds(
  supabase: AppSupabaseClient,
  userId: string,
  contactIds: string[],
): Promise<{ eligible: string[]; ineligible: number }> {
  const eligible: string[] = [];

  for (const slice of chunk(contactIds, SELECT_CHUNK)) {
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .eq("user_id", userId)
      .eq("is_unsubscribed", false)
      .eq("is_suppressed", false)
      .in("id", slice);
    eligible.push(...(data ?? []).map((row) => row.id));
  }

  return { eligible, ineligible: contactIds.length - eligible.length };
}

async function replaceSelection(
  supabase: AppSupabaseClient,
  userId: string,
  scope: ResultScope,
  resultIds: string[],
): Promise<boolean> {
  const clear = applyScope(
    supabase
      .from("email_finder_results")
      .update({ selected: false })
      .eq("user_id", userId),
    scope,
  );
  await clear.eq("selected", true);

  for (const slice of chunk(resultIds, WRITE_CHUNK)) {
    const query = applyScope(
      supabase
        .from("email_finder_results")
        .update({ selected: true })
        .eq("user_id", userId),
      scope,
    );
    const { error } = await query.in("id", slice);
    if (error) return false;
  }

  return true;
}

function summarize(outcome: SaveOutcome): EmailFinderActionState {
  return {
    success: `${outcome.created} contact${outcome.created === 1 ? "" : "s"} added${
      outcome.existing ? `, ${outcome.existing} already in Contacts` : ""
    }.`,
    created: outcome.created,
    existing: outcome.existing,
  };
}

async function addToContacts(
  scope: ResultScope,
  resultIds: string[],
): Promise<EmailFinderActionState> {
  const parsed = selectionSchema.safeParse({ ...scope, resultIds });
  if (!parsed.success) return { error: "Select at least one valid email." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const outcome = await saveResultsAsContacts(supabase, user.id, scope, resultIds);
  if (outcome.error) return { error: outcome.error };

  revalidatePath("/email-finder");
  revalidatePath("/contacts");
  return summarize(outcome);
}

async function addToCampaign(
  scope: ResultScope,
  resultIds: string[],
  campaignId: string,
): Promise<EmailFinderActionState> {
  const parsed = selectionSchema.safeParse({ ...scope, resultIds });
  const campaign = z.string().uuid().safeParse(campaignId);
  if (!parsed.success || !campaign.success) {
    return { error: "Select emails and a campaign." };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const outcome = await saveResultsAsContacts(supabase, user.id, scope, resultIds);
  if (outcome.error) return { error: outcome.error };

  const { eligible } = await eligibleContactIds(supabase, user.id, [
    ...new Set(outcome.contactIdsByEmail.values()),
  ]);

  if (!eligible.length) {
    return { error: "No eligible contacts were available for enrollment." };
  }

  const enrolled = await enrollCampaignContactsAction(campaign.data, eligible);
  if (enrolled.error) return { error: enrolled.error };

  revalidatePath("/email-finder");
  revalidatePath(`/campaigns/${campaign.data}`);
  return {
    success: enrolled.success ?? "Contacts added to campaign.",
    created: outcome.created,
    existing: outcome.existing,
    enrolled: eligible.length,
    campaignId: campaign.data,
  };
}

async function prepareForNewCampaign(
  scope: ResultScope,
  resultIds: string[],
): Promise<EmailFinderActionState & { contactIds?: string[] }> {
  const parsed = selectionSchema.safeParse({ ...scope, resultIds });
  if (!parsed.success) return { error: "Select at least one valid email." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const outcome = await saveResultsAsContacts(supabase, user.id, scope, resultIds);
  if (outcome.error) return { error: outcome.error };

  const { eligible, ineligible } = await eligibleContactIds(supabase, user.id, [
    ...new Set(outcome.contactIdsByEmail.values()),
  ]);

  if (!eligible.length) {
    return {
      error: "Selected emails are not eligible for a campaign.",
      ineligible,
    };
  }

  return {
    success: "Contacts ready for campaign.",
    created: outcome.created,
    existing: outcome.existing,
    contactIds: eligible,
    ineligible,
  };
}

// ---------------------------------------------------------------------------
// Single-scan actions
// ---------------------------------------------------------------------------

export async function setEmailFinderSelectionAction(
  scanId: string,
  resultIds: string[],
  selected: boolean,
): Promise<EmailFinderActionState> {
  const parsed = selectionSchema.safeParse({ scanId, resultIds });
  if (!parsed.success) return { error: "Select at least one valid result." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { error } = await supabase
    .from("email_finder_results")
    .update({ selected })
    .eq("user_id", user.id)
    .eq("scan_id", scanId)
    .in("id", parsed.data.resultIds.slice(0, MAX_FINDER_SELECTION));

  if (error) return { error: "Unable to update selection." };
  revalidatePath("/email-finder");
  return { success: selected ? "Selection updated." : "Selection cleared." };
}

export async function addFinderResultsToContactsAction(
  scanId: string,
  resultIds: string[],
): Promise<EmailFinderActionState> {
  return addToContacts({ scanId }, resultIds);
}

export async function addFinderResultsToCampaignAction(
  scanId: string,
  resultIds: string[],
  campaignId: string,
): Promise<EmailFinderActionState> {
  return addToCampaign({ scanId }, resultIds, campaignId);
}

export async function prepareFinderCampaignContactsAction(
  scanId: string,
  resultIds: string[],
): Promise<EmailFinderActionState & { contactIds?: string[] }> {
  return prepareForNewCampaign({ scanId }, resultIds);
}

export async function markFinderResultsSelectedAction(
  scanId: string,
  resultIds: string[],
): Promise<EmailFinderActionState> {
  const parsed = selectionSchema.safeParse({ scanId, resultIds });
  if (!parsed.success) return { error: "Invalid selection." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const saved = await replaceSelection(
    supabase,
    user.id,
    { scanId },
    parsed.data.resultIds,
  );
  if (!saved) return { error: "Unable to save selection." };

  revalidatePath("/email-finder");
  return { success: "Selection saved." };
}

// ---------------------------------------------------------------------------
// Batch actions
// ---------------------------------------------------------------------------

export async function addBatchResultsToContactsAction(
  batchId: string,
  resultIds: string[],
): Promise<EmailFinderActionState> {
  return addToContacts({ batchId }, resultIds);
}

export async function addBatchResultsToCampaignAction(
  batchId: string,
  resultIds: string[],
  campaignId: string,
): Promise<EmailFinderActionState> {
  return addToCampaign({ batchId }, resultIds, campaignId);
}

export async function prepareBatchCampaignContactsAction(
  batchId: string,
  resultIds: string[],
): Promise<EmailFinderActionState & { contactIds?: string[] }> {
  return prepareForNewCampaign({ batchId }, resultIds);
}

export async function markBatchResultsSelectedAction(
  batchId: string,
  resultIds: string[],
): Promise<EmailFinderActionState> {
  const parsed = selectionSchema.safeParse({ batchId, resultIds });
  if (!parsed.success) return { error: "Invalid selection." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const saved = await replaceSelection(
    supabase,
    user.id,
    { batchId },
    parsed.data.resultIds,
  );
  if (!saved) return { error: "Unable to save selection." };

  revalidatePath("/email-finder");
  return { success: "Selection saved." };
}
