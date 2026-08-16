/**
 * Drives a slice of the caller's own batch so progress is visible immediately
 * while the page is open. The cron worker keeps the same batch moving after the
 * page is closed.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { processEmailFinderBatches } from "@/features/email-finder/batch-worker";
import { getBatchProgress } from "@/features/email-finder/batch-queries";
import { USER_FACING_SCAN_ERRORS } from "@/features/email-finder/schemas";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function trustedClient(
  fallback: SupabaseClient<Database>,
): SupabaseClient<Database> {
  try {
    return createServiceRoleClient();
  } catch {
    return fallback;
  }
}

async function authorize(id: string) {
  const batchId = z.string().uuid().safeParse(id);
  if (!batchId.success) return { error: "Batch not found." as const, status: 404 };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: USER_FACING_SCAN_ERRORS.unauthorized, status: 401 };
  }

  return { supabase, userId: user.id, batchId: batchId.data };
}

/** Lightweight polling so counters move while a run is still in flight. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authorize(id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const progress = await getBatchProgress(auth.supabase, auth.userId, auth.batchId);
  if (!progress) {
    return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, progress });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const batchId = z.string().uuid().safeParse(id);
  if (!batchId.success) {
    return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: USER_FACING_SCAN_ERRORS.unauthorized },
      { status: 401 },
    );
  }

  const { data: batch } = await supabase
    .from("email_finder_batches")
    .select("id, status")
    .eq("id", batchId.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!batch) {
    return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  }

  if (batch.status === "paused" || batch.status === "cancelled") {
    const progress = await getBatchProgress(supabase, user.id, batchId.data);
    return NextResponse.json({ ok: true, idle: true, progress });
  }

  const worker = trustedClient(supabase);
  const summary = await processEmailFinderBatches(worker, {
    userId: user.id,
    batchId: batchId.data,
    budgetMs: 40_000,
  });

  const progress = await getBatchProgress(supabase, user.id, batchId.data);

  return NextResponse.json({ ok: true, summary, progress });
}
