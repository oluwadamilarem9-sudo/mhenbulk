import { timingSafeEqual } from "node:crypto";

import { processCampaignQueueBatch } from "@/features/campaigns/queue-worker";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAMPAIGNS_PER_RUN = 10;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return false;
  }

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

  const startedAt = Date.now();
  const supabase = createServiceRoleClient();

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, user_id")
    .eq("status", "sending")
    .order("started_at", { ascending: true })
    .limit(CAMPAIGNS_PER_RUN);

  if (error) {
    console.error("[queue-worker] Failed to list campaigns", error);
    return Response.json(
      { error: "Unable to list sending campaigns." },
      { status: 500 },
    );
  }

  const results = [];

  for (const campaign of campaigns ?? []) {
    const result = await processCampaignQueueBatch(
      supabase,
      campaign.user_id,
      campaign.id,
    );

    results.push({
      campaignId: campaign.id,
      ...result,
    });
  }

  const summary = results.reduce(
    (totals, result) => ({
      processed: totals.processed + (result.processed ?? 0),
      sent: totals.sent + (result.sent ?? 0),
      failed: totals.failed + (result.failed ?? 0),
      skipped: totals.skipped + (result.skipped ?? 0),
      retriesScheduled:
        totals.retriesScheduled + (result.retriesScheduled ?? 0),
    }),
    { processed: 0, sent: 0, failed: 0, skipped: 0, retriesScheduled: 0 },
  );

  console.info("[queue-worker] Run completed", {
    campaigns: results.length,
    ...summary,
    durationMs: Date.now() - startedAt,
  });

  return Response.json({
    ok: true,
    campaigns: results.length,
    ...summary,
    durationMs: Date.now() - startedAt,
    results,
  });
}

/** Vercel Cron calls this endpoint with GET. */
export async function GET(request: Request) {
  return handleWorkerRequest(request);
}

/** POST is useful for external schedulers and controlled manual tests. */
export async function POST(request: Request) {
  return handleWorkerRequest(request);
}
