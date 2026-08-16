import { NextResponse } from "next/server";

import { getEmailFinderConfig } from "@/features/email-finder/config";
import { crawlWebsiteForEmails } from "@/features/email-finder/crawler";
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
    const completedAt = new Date().toISOString();
    const { data: failedScan } = await supabase
      .from("email_finder_scans")
      .insert({
        user_id: user.id,
        target_url: parsed.data.url.trim(),
        domain: validatedDomain,
        status: "failed",
        pages_scanned: 0,
        emails_found: 0,
        error_code: code,
        error_message: message,
        completed_at: completedAt,
      })
      .select("id")
      .single();

    return NextResponse.json(
      {
        error: message,
        code,
        scanId: failedScan?.id ?? null,
      },
      { status: 422 },
    );
  }

  const crawl = await crawlWebsiteForEmails(validatedHref);
  const completedAt = new Date().toISOString();

  if (!crawl.ok) {
    const { data: failedScan } = await supabase
      .from("email_finder_scans")
      .insert({
        user_id: user.id,
        target_url: validatedHref,
        domain: validatedDomain,
        status: "failed",
        pages_scanned: 0,
        emails_found: 0,
        error_code: crawl.error.code,
        error_message: crawl.error.message,
        completed_at: completedAt,
      })
      .select("id")
      .single();

    return NextResponse.json(
      {
        error: crawl.error.message,
        code: crawl.error.code,
        scanId: failedScan?.id ?? null,
      },
      { status: 422 },
    );
  }

  const { data: scan, error: scanError } = await supabase
    .from("email_finder_scans")
    .insert({
      user_id: user.id,
      target_url: crawl.data.targetUrl,
      domain: crawl.data.domain,
      status: crawl.data.status,
      pages_scanned: crawl.data.pagesScanned,
      emails_found: crawl.data.emails.length,
      limit_reached: crawl.data.limitReached,
      javascript_hint: crawl.data.javascriptHint,
      error_message: crawl.data.warning ?? null,
      completed_at: completedAt,
    })
    .select(
      "id, target_url, domain, status, pages_scanned, emails_found, limit_reached, javascript_hint, error_message, created_at, completed_at",
    )
    .single();

  if (scanError || !scan) {
    console.info("[email-finder] Failed to persist scan", {
      message: scanError?.message,
    });
    return NextResponse.json(
      { error: USER_FACING_SCAN_ERRORS.scan_failed, code: "scan_failed" },
      { status: 500 },
    );
  }

  if (crawl.data.emails.length) {
    const rows = crawl.data.emails.map((item) => ({
      user_id: user.id,
      scan_id: scan.id,
      email: item.email,
      source_url: item.sourceUrl,
      category: item.category,
      selected: false,
    }));

    for (let index = 0; index < rows.length; index += 200) {
      const { error: insertError } = await supabase
        .from("email_finder_results")
        .insert(rows.slice(index, index + 200));
      if (insertError) {
        console.info("[email-finder] Failed to persist results", {
          scanId: scan.id,
          message: insertError.message,
        });
        return NextResponse.json(
          { error: USER_FACING_SCAN_ERRORS.scan_failed, code: "scan_failed" },
          { status: 500 },
        );
      }
    }
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
