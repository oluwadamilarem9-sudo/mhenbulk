import { createClient } from "@/lib/supabase/server";
import type {
  EmailFinderCategory,
  EmailFinderScanStatus,
} from "@/lib/supabase/database.types";

export type EmailFinderScanSummary = {
  id: string;
  targetUrl: string;
  domain: string;
  status: EmailFinderScanStatus;
  pagesScanned: number;
  emailsFound: number;
  limitReached: boolean;
  javascriptHint: boolean;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type EmailFinderResultRow = {
  id: string;
  scanId: string;
  email: string;
  sourceUrl: string;
  category: EmailFinderCategory;
  selected: boolean;
  addedToContacts: boolean;
  contactId: string | null;
  createdAt: string;
};

export type EmailFinderScanDetail = {
  scan: EmailFinderScanSummary;
  results: EmailFinderResultRow[];
};

function mapScan(row: {
  id: string;
  target_url: string;
  domain: string;
  status: EmailFinderScanStatus;
  pages_scanned: number;
  emails_found: number;
  limit_reached: boolean;
  javascript_hint: boolean;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}): EmailFinderScanSummary {
  return {
    id: row.id,
    targetUrl: row.target_url,
    domain: row.domain,
    status: row.status,
    pagesScanned: row.pages_scanned,
    emailsFound: row.emails_found,
    limitReached: row.limit_reached,
    javascriptHint: row.javascript_hint,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapResult(row: {
  id: string;
  scan_id: string;
  email: string;
  source_url: string;
  category: EmailFinderCategory;
  selected: boolean;
  added_to_contacts: boolean;
  contact_id: string | null;
  created_at: string;
}): EmailFinderResultRow {
  return {
    id: row.id,
    scanId: row.scan_id,
    email: row.email,
    sourceUrl: row.source_url,
    category: row.category,
    selected: row.selected,
    addedToContacts: row.added_to_contacts,
    contactId: row.contact_id,
    createdAt: row.created_at,
  };
}

export async function listRecentEmailFinderScans(
  userId: string,
  limit = 20,
): Promise<EmailFinderScanSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_finder_scans")
    .select(
      "id, target_url, domain, status, pages_scanned, emails_found, limit_reached, javascript_hint, error_message, created_at, completed_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []).map(mapScan);
}

export async function getEmailFinderScanDetail(
  userId: string,
  scanId: string,
): Promise<EmailFinderScanDetail | null> {
  const supabase = await createClient();
  const { data: scan } = await supabase
    .from("email_finder_scans")
    .select(
      "id, target_url, domain, status, pages_scanned, emails_found, limit_reached, javascript_hint, error_message, created_at, completed_at",
    )
    .eq("id", scanId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!scan) return null;

  const { data: results } = await supabase
    .from("email_finder_results")
    .select(
      "id, scan_id, email, source_url, category, selected, added_to_contacts, contact_id, created_at",
    )
    .eq("scan_id", scanId)
    .eq("user_id", userId)
    .order("email", { ascending: true });

  return {
    scan: mapScan(scan),
    results: (results ?? []).map(mapResult),
  };
}

export async function countRecentScans(
  userId: string,
  withinMs: number,
): Promise<number> {
  const supabase = await createClient();
  const since = new Date(Date.now() - withinMs).toISOString();
  const { count } = await supabase
    .from("email_finder_scans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  return count ?? 0;
}

export async function listDraftCampaignOptions(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("id, name, status")
    .eq("user_id", userId)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(100);
  return data ?? [];
}
