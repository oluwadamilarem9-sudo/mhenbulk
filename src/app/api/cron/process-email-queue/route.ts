import { timingSafeEqual } from "node:crypto";

import { processCampaignQueueBatch } from "@/features/campaigns/queue-worker";
import { getQueueConfig } from "@/lib/env";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CAMPAIGNS_PER_RUN = 10;
const WORKER_TIME_BUDGET_MS = 40_000;

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

async function resumeRateLimitedAccounts() {
  const supabase = createServiceRoleClient();
  const nowIso = new Date().toISOString();

  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("id, user_id")
    .eq("status", "rate_limited")
    .not("rate_limited_until", "is", null)
    .lte("rate_limited_until", nowIso)
    .limit(50);

  for (const account of accounts ?? []) {
    await supabase
      .from("email_accounts")
      .update({
        status: "connected",
        rate_limited_until: null,
        last_error: null,
      })
      .eq("id", account.id);

    await supabase
      .from("campaigns")
      .update({
        status: "sending",
        paused_at: null,
        pause_reason: null,
      })
      .eq("user_id", account.user_id)
      .eq("email_account_id", account.id)
      .eq("status", "paused")
      .eq("pause_reason", "rate_limit");
  }
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

  await resumeRateLimitedAccounts();

  const nowIso = new Date().toISOString();
  const [
    { data: dueRecipients, error: dueError },
    { data: automatedCampaigns, error: automationError },
  ] = await Promise.all([
    supabase
      .from("campaign_recipients")
      .select("campaign_id, user_id")
      .in("status", ["pending", "queued"])
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
      .order("next_attempt_at", { ascending: true, nullsFirst: true })
      .limit(100),
    supabase
      .from("campaigns")
      .select("id, user_id")
      .eq("automation_enabled", true)
      .in("status", ["sending", "scheduled", "completed"])
      .order("updated_at", { ascending: true })
      .limit(50),
  ]);

  if (dueError || automationError) {
    console.error("[queue-worker] Failed to list due work", {
      dueError,
      automationError,
    });
    return Response.json(
      { error: "Unable to list due campaigns." },
      { status: 500 },
    );
  }

  const campaignMap = new Map<string, { id: string; user_id: string }>();
  for (const row of dueRecipients ?? []) {
    campaignMap.set(row.campaign_id, {
      id: row.campaign_id,
      user_id: row.user_id,
    });
  }
  for (const campaign of automatedCampaigns ?? []) {
    campaignMap.set(campaign.id, campaign);
  }
  const campaigns = [...campaignMap.values()].slice(0, CAMPAIGNS_PER_RUN);
  const { data: campaignAccounts } = campaigns.length
    ? await supabase
        .from("campaigns")
        .select("id, email_account_id")
        .in(
          "id",
          campaigns.map((campaign) => campaign.id),
        )
    : { data: [] };
  const accountByCampaign = new Map(
    (campaignAccounts ?? []).map((campaign) => [
      campaign.id,
      campaign.email_account_id,
    ]),
  );
  const groups = new Map<
    string,
    Array<{ id: string; user_id: string }>
  >();
  for (const campaign of campaigns) {
    // Campaigns sharing one Gmail account always remain sequential. Configured
    // concurrency only runs independent sending accounts alongside each other.
    const key = `${campaign.user_id}:${
      accountByCampaign.get(campaign.id) ?? campaign.id
    }`;
    groups.set(key, [...(groups.get(key) ?? []), campaign]);
  }

  const results: Array<
    { campaignId: string } & Awaited<
      ReturnType<typeof processCampaignQueueBatch>
    >
  > = [];
  const accountGroups = [...groups.values()];
  const { concurrency } = getQueueConfig();
  let nextGroup = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, accountGroups.length) },
      async () => {
        while (nextGroup < accountGroups.length) {
          const group = accountGroups[nextGroup++];
          for (const campaign of group) {
            let keepPumping = true;
            while (
              keepPumping &&
              Date.now() - startedAt < WORKER_TIME_BUDGET_MS
            ) {
              const result = await processCampaignQueueBatch(
                supabase,
                campaign.user_id,
                campaign.id,
              );
              results.push({ campaignId: campaign.id, ...result });
              keepPumping =
                !result.error &&
                (result.processed ?? 0) > 0 &&
                (result.remaining ?? 0) > 0;
            }
          }
        }
      },
    ),
  );

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

  const campaignCount = new Set(results.map((result) => result.campaignId)).size;
  console.info("[queue-worker] Run completed", {
    campaigns: campaignCount,
    slices: results.length,
    ...summary,
    durationMs: Date.now() - startedAt,
  });

  return Response.json({
    ok: true,
    campaigns: campaignCount,
    slices: results.length,
    ...summary,
    durationMs: Date.now() - startedAt,
    results,
  });
}

/** Vercel Cron / Supabase Cron / external schedulers call this endpoint. */
export async function GET(request: Request) {
  return handleWorkerRequest(request);
}

/** POST is useful for external schedulers and controlled manual tests. */
export async function POST(request: Request) {
  return handleWorkerRequest(request);
}
