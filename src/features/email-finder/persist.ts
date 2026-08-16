/**
 * Shared persistence for finder scans so single-URL scans and queued batch
 * scans always write identical rows.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CrawlResult } from "@/features/email-finder/crawler";
import type { Database } from "@/lib/supabase/database.types";

type AppSupabaseClient = SupabaseClient<Database>;

const RESULT_CHUNK = 200;

export type PersistedScan = {
  scanId: string;
  emailsFound: number;
};

/** Omitted entirely for single searches so the column stays optional. */
function batchLink(batchId?: string | null) {
  return batchId ? { batch_id: batchId } : {};
}

export async function persistFailedScan(
  supabase: AppSupabaseClient,
  params: {
    userId: string;
    targetUrl: string;
    domain: string;
    code: string;
    message: string;
    batchId?: string | null;
  },
): Promise<string | null> {
  const { data } = await supabase
    .from("email_finder_scans")
    .insert({
      user_id: params.userId,
      target_url: params.targetUrl,
      domain: params.domain,
      status: "failed",
      pages_scanned: 0,
      emails_found: 0,
      error_code: params.code,
      error_message: params.message,
      ...batchLink(params.batchId),
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  return data?.id ?? null;
}

export async function persistCompletedScan(
  supabase: AppSupabaseClient,
  params: {
    userId: string;
    crawl: CrawlResult;
    batchId?: string | null;
  },
): Promise<PersistedScan | null> {
  const { crawl } = params;
  const { data: scan, error } = await supabase
    .from("email_finder_scans")
    .insert({
      user_id: params.userId,
      target_url: crawl.targetUrl,
      domain: crawl.domain,
      status: crawl.status,
      pages_scanned: crawl.pagesScanned,
      emails_found: crawl.emails.length,
      limit_reached: crawl.limitReached,
      javascript_hint: crawl.javascriptHint,
      error_message: crawl.warning ?? null,
      ...batchLink(params.batchId),
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !scan) {
    console.info("[email-finder] Failed to persist scan", {
      domain: crawl.domain,
      message: error?.message,
    });
    return null;
  }

  if (!crawl.emails.length) {
    return { scanId: scan.id, emailsFound: 0 };
  }

  const rows = crawl.emails.map((item) => ({
    user_id: params.userId,
    scan_id: scan.id,
    email: item.email,
    source_url: item.sourceUrl,
    category: item.category,
    selected: false,
  }));

  for (let index = 0; index < rows.length; index += RESULT_CHUNK) {
    const { error: insertError } = await supabase
      .from("email_finder_results")
      .insert(rows.slice(index, index + RESULT_CHUNK));
    if (insertError) {
      console.info("[email-finder] Failed to persist results", {
        scanId: scan.id,
        message: insertError.message,
      });
      return null;
    }
  }

  return { scanId: scan.id, emailsFound: crawl.emails.length };
}
