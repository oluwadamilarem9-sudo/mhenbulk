"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { processCampaignQueueBatch } from "@/features/campaigns/queue-worker";
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

  const result = await processCampaignQueueBatch(supabase, user.id, parsedId.data);

  revalidatePath(`/campaigns/${parsedId.data}`);
  revalidatePath("/campaigns");
  revalidatePath("/dashboard");

  return result;
}
