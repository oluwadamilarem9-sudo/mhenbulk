import { timingSafeEqual } from "node:crypto";

import { processEmailFinderBatches } from "@/features/email-finder/batch-worker";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

async function handleWorkerRequest(request: Request) {
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }

  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const summary = await processEmailFinderBatches(supabase, { budgetMs: 45_000 });

  return Response.json({ ok: true, ...summary });
}

/** Vercel Cron / Supabase Cron / external schedulers call this endpoint. */
export async function GET(request: Request) {
  return handleWorkerRequest(request);
}

export async function POST(request: Request) {
  return handleWorkerRequest(request);
}
