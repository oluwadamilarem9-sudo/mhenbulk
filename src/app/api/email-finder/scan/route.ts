import { NextResponse } from "next/server";

import { getEmailFinderConfig } from "@/features/email-finder/config";
import { crawlWebsiteForEmails } from "@/features/email-finder/crawler";
import {
  persistCompletedScan,
  persistFailedScan,
} from "@/features/email-finder/persist";
import { countRecentScans } from "@/features/email-finder/queries";
import {
  USER_FACING_SCAN_ERRORS,
  scanRequestSchema,
} from "@/features/email-finder/schemas";
import {
  SafeUrlError,
  validatePublicHttpUrl,
} from "@/features/email-finder/url-security";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      {
        error: USER_FACING_SCAN_ERRORS.unauthorized,
        code: "unauthorized",
      },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: USER_FACING_SCAN_ERRORS.invalid_url, code: "invalid_url" },
      { status: 400 },
    );
  }

  const parsed = scanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: USER_FACING_SCAN_ERRORS.invalid_url, code: "invalid_url" },
      { status: 400 },
    );
  }

  const config = getEmailFinderConfig();
  const recent = await countRecentScans(user.id, 60 * 60 * 1000);
  if (recent >= config.maxScansPerHour) {
    return NextResponse.json(
      { error: USER_FACING_SCAN_ERRORS.rate_limited, code: "rate_limited" },
      { status: 429 },
    );
  }

  let validatedHref = parsed.data.url.trim();
  let validatedDomain = "unknown";
  try {
    const validated = await validatePublicHttpUrl(parsed.data.url);
    validatedHref = validated.href;
    validatedDomain = validated.hostname;
  } catch (error) {
    const code = error instanceof SafeUrlError ? error.code : "invalid_url";
    const message =
      USER_FACING_SCAN_ERRORS[code] ?? USER_FACING_SCAN_ERRORS.invalid_url;
    const failedScanId = await persistFailedScan(supabase, {
      userId: user.id,
      targetUrl: parsed.data.url.trim(),
      domain: validatedDomain,
      code,
      message,
    });

    return NextResponse.json(
      {
        error: message,
        code,
        scanId: failedScanId,
      },
      { status: 422 },
    );
  }

  const crawl = await crawlWebsiteForEmails(validatedHref);

  if (!crawl.ok) {
    const failedScanId = await persistFailedScan(supabase, {
      userId: user.id,
      targetUrl: validatedHref,
      domain: validatedDomain,
      code: crawl.error.code,
      message: crawl.error.message,
    });

    return NextResponse.json(
      {
        error: crawl.error.message,
        code: crawl.error.code,
        scanId: failedScanId,
      },
      { status: 422 },
    );
  }

  const persisted = await persistCompletedScan(supabase, {
    userId: user.id,
    crawl: crawl.data,
  });

  if (!persisted) {
    return NextResponse.json(
      { error: USER_FACING_SCAN_ERRORS.scan_failed, code: "scan_failed" },
      { status: 500 },
    );
  }

  const { data: scan } = await supabase
    .from("email_finder_scans")
    .select(
      "id, target_url, domain, status, pages_scanned, emails_found, limit_reached, javascript_hint, error_message, created_at, completed_at",
    )
    .eq("id", persisted.scanId)
    .eq("user_id", user.id)
    .single();

  if (!scan) {
    return NextResponse.json(
      { error: USER_FACING_SCAN_ERRORS.scan_failed, code: "scan_failed" },
      { status: 500 },
    );
  }

  const { data: results } = await supabase
    .from("email_finder_results")
    .select(
      "id, scan_id, email, source_url, category, selected, added_to_contacts, contact_id, created_at",
    )
    .eq("scan_id", scan.id)
    .eq("user_id", user.id)
    .order("email", { ascending: true });

  return NextResponse.json({
    scan: {
      id: scan.id,
      targetUrl: scan.target_url,
      domain: scan.domain,
      status: scan.status,
      pagesScanned: scan.pages_scanned,
      emailsFound: scan.emails_found,
      limitReached: scan.limit_reached,
      javascriptHint: scan.javascript_hint,
      errorMessage: scan.error_message,
      createdAt: scan.created_at,
      completedAt: scan.completed_at,
    },
    results: (results ?? []).map((row) => ({
      id: row.id,
      scanId: row.scan_id,
      email: row.email,
      sourceUrl: row.source_url,
      category: row.category,
      selected: row.selected,
      addedToContacts: row.added_to_contacts,
      contactId: row.contact_id,
      createdAt: row.created_at,
    })),
    scannedPages: crawl.data.scannedPages,
    warning: crawl.data.warning ?? null,
  });
}
