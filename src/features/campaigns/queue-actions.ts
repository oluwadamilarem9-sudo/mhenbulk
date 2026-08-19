"use server";

import { z } from "zod";

import { drainUserEmailQueue } from "@/features/campaigns/queue-worker";
import type { QueueBatchResult } from "@/features/campaigns/schemas";
import { createClient } from "@/lib/supabase/server";

export async function processQueueBatchAction(
  campaignId: string,
): Promise<QueueBatchResult> {
  const parsedId = z.string().uuid().safeParse(campaignId);

  if (!parsedId.success) {
    return { error: "Invalid campaign reference." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  return drainUserEmailQueue(supabase, user.id, {
    campaignId: parsedId.data,
  });
}
