"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseWebsiteUrlFile } from "@/features/email-finder/url-file";
import { createClient } from "@/lib/supabase/server";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const INSERT_CHUNK = 500;

export type BatchActionState = {
  error?: string;
  success?: string;
  batchId?: string;
  queued?: number;
  duplicates?: number;
  skipped?: number;
  truncated?: boolean;
};

const batchIdSchema = z.string().uuid();

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Queues every website in an uploaded list. Scanning happens in the background
 * worker, so this only validates and stores the targets.
 */
export async function createWebsiteScanBatchAction(
  formData: FormData,
): Promise<BatchActionState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "Website lists are limited to 2 MB." };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const parsed = parseWebsiteUrlFile(await file.text(), file.name);
  if (parsed.error || parsed.rows.length === 0) {
    return {
      error:
        parsed.error ??
        "We couldn't find any website addresses in this file.",
    };
  }

  const { data: batch, error: batchError } = await supabase
    .from("email_finder_batches")
    .insert({
      user_id: user.id,
      name: file.name.slice(0, 200),
      status: "pending",
      total_targets: parsed.rows.length,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return { error: "Unable to start this scan. Please try again." };
  }

  const rows = parsed.rows.map((row, index) => ({
    user_id: user.id,
    batch_id: batch.id,
    position: index,
    url: row.url,
    domain: row.domain,
  }));

  for (let index = 0; index < rows.length; index += INSERT_CHUNK) {
    const { error: insertError } = await supabase
      .from("email_finder_batch_targets")
      .insert(rows.slice(index, index + INSERT_CHUNK));

    if (insertError) {
      await supabase
        .from("email_finder_batches")
        .delete()
        .eq("id", batch.id)
        .eq("user_id", user.id);
      return { error: "Unable to queue these websites. Please try again." };
    }
  }

  revalidatePath("/email-finder");

  return {
    success: `${rows.length} website${rows.length === 1 ? "" : "s"} queued for scanning.`,
    batchId: batch.id,
    queued: rows.length,
    duplicates: parsed.duplicates,
    skipped: parsed.skipped,
    truncated: parsed.truncated,
  };
}

async function setBatchStatus(
  batchId: string,
  status: "running" | "paused",
): Promise<BatchActionState> {
  const parsed = batchIdSchema.safeParse(batchId);
  if (!parsed.success) return { error: "Batch not found." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { error } = await supabase
    .from("email_finder_batches")
    .update({ status })
    .eq("id", parsed.data)
    .eq("user_id", user.id)
    .in("status", ["pending", "running", "paused"]);

  if (error) return { error: "Unable to update this scan." };

  revalidatePath("/email-finder");
  return {
    success: status === "paused" ? "Scanning paused." : "Scanning resumed.",
    batchId: parsed.data,
  };
}

export async function pauseWebsiteScanBatchAction(batchId: string) {
  return setBatchStatus(batchId, "paused");
}

export async function resumeWebsiteScanBatchAction(batchId: string) {
  return setBatchStatus(batchId, "running");
}

/** Stops remaining work but keeps every email already discovered. */
export async function cancelWebsiteScanBatchAction(
  batchId: string,
): Promise<BatchActionState> {
  const parsed = batchIdSchema.safeParse(batchId);
  if (!parsed.success) return { error: "Batch not found." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { error } = await supabase
    .from("email_finder_batches")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("user_id", user.id);

  if (error) return { error: "Unable to stop this scan." };

  await supabase
    .from("email_finder_batch_targets")
    .update({ status: "skipped", claimed_at: null })
    .eq("batch_id", parsed.data)
    .eq("user_id", user.id)
    .eq("status", "queued");

  revalidatePath("/email-finder");
  return { success: "Scanning stopped.", batchId: parsed.data };
}

export async function deleteWebsiteScanBatchAction(
  batchId: string,
): Promise<BatchActionState> {
  const parsed = batchIdSchema.safeParse(batchId);
  if (!parsed.success) return { error: "Batch not found." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { error } = await supabase
    .from("email_finder_batches")
    .delete()
    .eq("id", parsed.data)
    .eq("user_id", user.id);

  if (error) return { error: "Unable to delete this scan." };

  revalidatePath("/email-finder");
  return { success: "Scan list deleted." };
}
