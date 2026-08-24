"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { enrollCampaignContactsAction } from "@/features/campaigns/actions";
import { createContactBatchesAction } from "@/features/smart-batching/actions";
import { createClient } from "@/lib/supabase/server";
import {
  buildDomainBreakdown,
  classifyEmailProvider,
  extractEmailDomain,
} from "@/lib/email-domain-stats";
import {
  cleanOneRecord,
  markDuplicates,
  parseCsvForCleaner,
  parsePastedEmails,
  toCsv,
  type CleanerInputRecord,
  type CleanerOutputRecord,
} from "@/features/email-cleaner/utils";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const idsSchema = z.array(z.string().uuid()).max(10000);

export async function createEmailCleaningJobFromPasteAction(input: {
  text: string;
  keepMode: "first" | "last";
}) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const records = parsePastedEmails(input.text).slice(0, 20000);
  if (records.length === 0) return { error: "Paste at least one email." };

  const { data: job, error } = await supabase
    .from("email_cleaning_jobs")
    .insert({
      user_id: user.id,
      source: "paste",
      keep_mode: input.keepMode,
      status: "pending",
      total_records: records.length,
      payload: { records },
    })
    .select("id")
    .single();
  if (error || !job) return { error: "Unable to start cleaning job." };
  return { jobId: job.id };
}

export async function createEmailCleaningJobFromCsvAction(input: {
  fileText: string;
  emailColumn?: string;
  keepMode: "first" | "last";
}) {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const parsed = parseCsvForCleaner(input.fileText, input.emailColumn);
  if (parsed.needsColumnSelection) {
    return {
      needsColumnSelection: true,
      columns: parsed.candidateEmailColumns,
      error:
        parsed.candidateEmailColumns.length > 0
          ? "Choose which column contains email addresses."
          : "No email-like column was detected.",
    };
  }
  if (parsed.records.length === 0) return { error: "No emails found in CSV." };

  const { data: job, error } = await supabase
    .from("email_cleaning_jobs")
    .insert({
      user_id: user.id,
      source: "csv",
      keep_mode: input.keepMode,
      status: "pending",
      total_records: parsed.records.length,
      payload: { records: parsed.records, headers: parsed.headers },
    })
    .select("id")
    .single();
  if (error || !job) return { error: "Unable to start cleaning job." };
  return { jobId: job.id };
}

export async function createEmailCleaningJobFromContactsAction(contactIds: string[]) {
  const parsed = idsSchema.safeParse([...new Set(contactIds)]);
  if (!parsed.success || parsed.data.length === 0) return { error: "No contacts selected." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, email, first_name, last_name, company")
    .eq("user_id", user.id)
    .in("id", parsed.data);
  const records: CleanerInputRecord[] = (contacts ?? []).map((contact, i) => ({
    rowIndex: i + 1,
    originalEmail: contact.email,
    extra: {
      contact_id: contact.id,
      first_name: contact.first_name ?? "",
      last_name: contact.last_name ?? "",
      company: contact.company ?? "",
    },
  }));
  if (!records.length) return { error: "No contact emails found." };

  const { data: job, error } = await supabase
    .from("email_cleaning_jobs")
    .insert({
      user_id: user.id,
      source: "contacts",
      keep_mode: "first",
      status: "pending",
      total_records: records.length,
      payload: { records },
    })
    .select("id")
    .single();
  if (error || !job) return { error: "Unable to start cleaning job." };
  return { jobId: job.id };
}

export async function createEmailCleaningJobFromFinderAction(scanId: string, resultIds: string[]) {
  const parsed = idsSchema.safeParse([...new Set(resultIds)]);
  if (!parsed.success || parsed.data.length === 0) return { error: "No finder results selected." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: rows } = await supabase
    .from("email_finder_results")
    .select("id, email, domain, source_url")
    .eq("user_id", user.id)
    .eq("scan_id", scanId)
    .in("id", parsed.data);

  const records: CleanerInputRecord[] = (rows ?? []).map((row, i) => ({
    rowIndex: i + 1,
    originalEmail: row.email,
    extra: {
      finder_result_id: row.id,
      domain: row.domain ?? "",
      source_url: row.source_url ?? "",
    },
  }));
  if (!records.length) return { error: "No emails found for selected rows." };

  const { data: job, error } = await supabase
    .from("email_cleaning_jobs")
    .insert({
      user_id: user.id,
      source: "email_finder",
      keep_mode: "first",
      status: "pending",
      total_records: records.length,
      payload: { records },
    })
    .select("id")
    .single();
  if (error || !job) return { error: "Unable to start cleaning job." };
  return { jobId: job.id };
}

const INSERT_CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function tally(rows: Array<{ status: string }>) {
  const counts = {
    valid: 0,
    corrected: 0,
    duplicate: 0,
    invalid: 0,
    suspicious: 0,
    review: 0,
  };
  for (const row of rows) {
    if (row.status === "VALID") counts.valid++;
    else if (row.status === "CORRECTED") counts.corrected++;
    else if (row.status === "DUPLICATE") counts.duplicate++;
    else if (row.status === "INVALID") counts.invalid++;
    else if (row.status === "SUSPICIOUS") counts.suspicious++;
    else if (row.status === "REVIEW_REQUIRED") counts.review++;
  }
  return counts;
}

function domainStatsFromRows(rows: CleanerOutputRecord[]) {
  const emails = rows
    .filter(
      (row) =>
        row.cleanEmail &&
        row.status !== "INVALID" &&
        row.status !== "DUPLICATE",
    )
    .map((row) => row.cleanEmail as string);
  return buildDomainBreakdown(emails, 5);
}

export async function processEmailCleaningJobAction(jobId: string) {
  const id = z.string().uuid().safeParse(jobId);
  if (!id.success) return { error: "Invalid cleaning job." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: job } = await supabase
    .from("email_cleaning_jobs")
    .select("*")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!job) return { error: "Cleaning job not found." };
  const status = job.status ?? "pending";
  if (status === "cancelled" || status === "completed" || status === "failed") {
    return { ok: true, status };
  }

  const payload =
    (job.payload as {
      records?: CleanerInputRecord[];
      domainStats?: ReturnType<typeof buildDomainBreakdown>;
    } | null) ?? {};
  const all = payload.records ?? [];
  const keepMode = (job.keep_mode === "last" ? "last" : "first") as "first" | "last";
  const processed = Number(job.processed_records ?? 0);

  if (processed >= all.length) {
    return { ok: true, status: "completed", processed: all.length };
  }

  console.info("[CLEANER] Job started", {
    jobId: id.data,
    total: all.length,
  });

  await supabase
    .from("email_cleaning_jobs")
    .update({ status: "processing" })
    .eq("id", id.data)
    .eq("user_id", user.id);

  const cleaned = all.map((record) => {
    try {
      return cleanOneRecord(record);
    } catch {
      return {
        rowIndex: record.rowIndex,
        originalEmail: record.originalEmail,
        cleanEmail: null,
        status: "INVALID" as const,
        issue: "Processing error",
        suggestedCorrection: null,
        confidence: null,
        extra: record.extra,
      };
    }
  });
  const withDupes = markDuplicates(cleaned, keepMode);
  const counts = tally(withDupes);
  const domainStats = domainStatsFromRows(withDupes);

  const rows = withDupes.map((row) => ({
    user_id: user.id,
    job_id: id.data,
    row_index: row.rowIndex,
    original_email: row.originalEmail,
    clean_email: row.cleanEmail,
    status: row.status,
    issue: row.issue,
    suggested_correction: row.suggestedCorrection,
    confidence: row.confidence,
    extra: {
      ...row.extra,
      domain: row.cleanEmail ? extractEmailDomain(row.cleanEmail) : "",
      email_type: row.cleanEmail
        ? classifyEmailProvider(extractEmailDomain(row.cleanEmail))
        : "Unknown",
    },
    selected: row.status !== "INVALID" && row.status !== "DUPLICATE",
  }));

  for (const slice of chunk(rows, INSERT_CHUNK)) {
    const { error } = await supabase.from("email_cleaning_results").insert(slice);
    if (error) {
      console.info("[CLEANER] Insert failed", { jobId: id.data, message: error.message });
      await supabase
        .from("email_cleaning_jobs")
        .update({
          status: "failed",
          error_message: "Unable to save cleaning results.",
        })
        .eq("id", id.data)
        .eq("user_id", user.id);
      return { error: "Unable to save cleaning results." };
    }
    console.info("[CLEANER] Chunk processed", {
      jobId: id.data,
      rows: slice.length,
    });
  }

  await supabase
    .from("email_cleaning_jobs")
    .update({
      status: "completed",
      processed_records: all.length,
      valid_count: counts.valid,
      corrected_count: counts.corrected,
      duplicate_count: counts.duplicate,
      invalid_count: counts.invalid,
      suspicious_count: counts.suspicious,
      review_count: counts.review,
      payload: {
        ...payload,
        domainStats,
        uniqueEmails: new Set(
          withDupes
            .filter((row) => row.cleanEmail && row.status !== "DUPLICATE")
            .map((row) => row.cleanEmail as string),
        ).size,
      },
      completed_at: new Date().toISOString(),
    })
    .eq("id", id.data)
    .eq("user_id", user.id);

  console.info("[CLEANER] Job completed", {
    jobId: id.data,
    total: all.length,
    ...counts,
  });

  return {
    ok: true,
    status: "completed" as const,
    processed: all.length,
    counts,
    domainStats,
  };
}

export async function cancelEmailCleaningJobAction(jobId: string) {
  const id = z.string().uuid().safeParse(jobId);
  if (!id.success) return { error: "Invalid cleaning job." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  await supabase
    .from("email_cleaning_jobs")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", id.data)
    .eq("user_id", user.id)
    .in("status", ["pending", "processing"]);
  return { success: "Cleaning cancelled." };
}

export async function setCleanerReviewDecisionAction(
  resultId: string,
  decision: "accept" | "reject" | "keep_original",
) {
  const id = z.string().uuid().safeParse(resultId);
  if (!id.success) return { error: "Invalid result row." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const { data: row } = await supabase
    .from("email_cleaning_results")
    .select("id, status, suggested_correction, clean_email")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return { error: "Result not found." };
  const suggested = row.suggested_correction ?? null;
  const clean = row.clean_email ?? null;

  await supabase
    .from("email_cleaning_results")
    .update({
      review_decision: decision,
      clean_email:
        decision === "accept" && suggested
          ? suggested
          : clean,
      status: decision === "reject" ? "INVALID" : "CORRECTED",
    })
    .eq("id", id.data)
    .eq("user_id", user.id);
  return { success: "Review decision saved." };
}

export async function setCleanerResultSelectionAction(
  jobId: string,
  resultIds: string[],
  selected: boolean,
) {
  const job = z.string().uuid().safeParse(jobId);
  const ids = idsSchema.safeParse([...new Set(resultIds)]);
  if (!job.success || !ids.success || ids.data.length === 0) {
    return { error: "Invalid selection update." };
  }
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  await supabase
    .from("email_cleaning_results")
    .update({ selected })
    .eq("job_id", job.data)
    .eq("user_id", user.id)
    .in("id", ids.data);
  return { success: "Selection updated." };
}

async function collectSelectedCleanEmails(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  jobId: string,
) {
  const { data } = await supabase
    .from("email_cleaning_results")
    .select("*")
    .eq("job_id", jobId)
    .eq("user_id", userId)
    .eq("selected", true)
    .in("status", ["VALID", "CORRECTED", "REVIEW_REQUIRED"]);
  return data ?? [];
}

export async function exportEmailCleaningCsvAction(jobId: string) {
  const id = z.string().uuid().safeParse(jobId);
  if (!id.success) return { error: "Invalid cleaning job." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const rows = await collectSelectedCleanEmails(supabase, user.id, id.data);
  const csv = toCsv(
    rows.map((row) => {
      const extra =
        row.extra && typeof row.extra === "object" && !Array.isArray(row.extra)
          ? (row.extra as Record<string, unknown>)
          : {};
      const domain =
        typeof extra.domain === "string"
          ? extra.domain
          : row.clean_email
            ? extractEmailDomain(row.clean_email)
            : "";
      const emailType =
        typeof extra.email_type === "string"
          ? extra.email_type
          : domain
            ? classifyEmailProvider(domain)
            : "Unknown";
      return {
        email: row.clean_email ?? "",
        domain,
        email_type: emailType,
        original_email: row.original_email ?? "",
        clean_email: row.clean_email ?? "",
        status: row.status ?? "",
        issue: row.issue ?? "",
        suggested_correction: row.suggested_correction ?? "",
      };
    }),
  );
  return { csv };
}

export async function addCleanerResultsToContactsAction(jobId: string) {
  const id = z.string().uuid().safeParse(jobId);
  if (!id.success) return { error: "Invalid cleaning job." };
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const rows = await collectSelectedCleanEmails(supabase, user.id, id.data);
  const emails = [
    ...new Set(
      rows
        .map((r) => (r.clean_email ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!emails.length) return { error: "No selected clean emails available." };

  const { data: existing } = await supabase
    .from("contacts")
    .select("email_normalized")
    .eq("user_id", user.id)
    .in("email_normalized", emails);
  const existingSet = new Set((existing ?? []).map((row) => row.email_normalized));

  const toInsert = rows
    .map((row) => {
      const clean = (row.clean_email ?? "").trim().toLowerCase();
      if (!clean || existingSet.has(clean)) return null;
      const extra =
        row.extra && typeof row.extra === "object" && !Array.isArray(row.extra)
          ? (row.extra as Record<string, unknown>)
          : {};
      return {
        user_id: user.id,
        email: clean,
        first_name: String(extra.first_name ?? ""),
        last_name: String(extra.last_name ?? ""),
        company: String(extra.company ?? "") || null,
      };
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v));

  if (toInsert.length) {
    await supabase.from("contacts").upsert(toInsert, {
      onConflict: "user_id,email_normalized",
      ignoreDuplicates: false,
    });
  }

  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  revalidatePath("/email-cleaner");
  return {
    success: "Contacts imported from cleaner.",
    imported: emails.length,
    newContacts: toInsert.length,
    alreadyExisted: emails.length - toInsert.length,
  };
}

export async function addCleanerResultsToCampaignAction(jobId: string, campaignId: string) {
  const id = z.string().uuid().safeParse(jobId);
  const cId = z.string().uuid().safeParse(campaignId);
  if (!id.success || !cId.success) return { error: "Invalid campaign selection." };
  const imported = await addCleanerResultsToContactsAction(id.data);
  if (imported.error) return imported;
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const rows = await collectSelectedCleanEmails(supabase, user.id, id.data);
  const emails = [
    ...new Set(
      rows
        .map((r) => (r.clean_email ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id")
    .eq("user_id", user.id)
    .in("email_normalized", emails);
  const contactIds = (contacts ?? []).map((c) => c.id);
  if (!contactIds.length) return { error: "No contacts available for campaign enrollment." };
  return enrollCampaignContactsAction(cId.data, contactIds);
}

export async function addCleanerResultsToSmartBatchesAction(
  jobId: string,
  batchSize: number,
) {
  const id = z.string().uuid().safeParse(jobId);
  if (!id.success) return { error: "Invalid cleaning job." };
  const imported = await addCleanerResultsToContactsAction(id.data);
  if (imported.error) return imported;
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };
  const rows = await collectSelectedCleanEmails(supabase, user.id, id.data);
  const emails = [
    ...new Set(
      rows
        .map((r) => (r.clean_email ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id")
    .eq("user_id", user.id)
    .in("email_normalized", emails);
  const ids = (contacts ?? []).map((c) => c.id);
  if (!ids.length) return { error: "No contacts available for batching." };
  return createContactBatchesAction(ids, batchSize, "manual");
}

