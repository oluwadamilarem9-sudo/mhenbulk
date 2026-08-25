import { NextResponse } from "next/server";
import { z } from "zod";

import {
  drainUserEmailQueue,
} from "@/features/campaigns/queue-worker";
import { getQueueConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  campaignId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Your session has expired. Please sign in again." },
      { status: 401 },
    );
  }

  let campaignId: string | undefined;
  try {
    const json: unknown = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid queue request." },
        { status: 400 },
      );
    }
    campaignId = parsed.data.campaignId;
  } catch {
    campaignId = undefined;
  }

  const { drainBudgetMs } = getQueueConfig();
  const result = await drainUserEmailQueue(supabase, user.id, {
    campaignId,
    timeBudgetMs: drainBudgetMs,
  });

  return NextResponse.json(result);
}
