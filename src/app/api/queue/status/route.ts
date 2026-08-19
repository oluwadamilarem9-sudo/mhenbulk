import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { RecipientStatus } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const campaignId = z.string().uuid().safeParse(url.searchParams.get("campaignId"));
  const campaignBatchId = z
    .string()
    .uuid()
    .safeParse(url.searchParams.get("campaignBatchId"));

  if (!campaignId.success) {
    return NextResponse.json({ error: "Invalid campaign reference." }, { status: 400 });
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, status")
    .eq("id", campaignId.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const countQuery = (statuses: RecipientStatus[]) => {
    let query = supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId.data)
      .eq("user_id", user.id)
      .in("status", statuses);
    if (campaignBatchId.success) {
      query = query.eq("campaign_batch_id", campaignBatchId.data);
    }
    return query;
  };

  const [sent, pending, failed, skipped] = await Promise.all([
    countQuery(["sent"]),
    countQuery(["pending", "queued", "sending"]),
    countQuery(["failed", "bounced"]),
    countQuery(["skipped"]),
  ]);

  if (sent.error || pending.error || failed.error || skipped.error) {
    return NextResponse.json({ error: "Unable to read send progress." }, { status: 500 });
  }

  const counts = {
    total:
      (sent.count ?? 0) +
      (pending.count ?? 0) +
      (failed.count ?? 0) +
      (skipped.count ?? 0),
    sent: sent.count ?? 0,
    pending: pending.count ?? 0,
    failed: failed.count ?? 0,
    skipped: skipped.count ?? 0,
  };

  return NextResponse.json({
    campaignId: campaign.id,
    campaignStatus: campaign.status,
    ...counts,
    percent:
      counts.total > 0 ? Math.round((counts.sent / counts.total) * 100) : 0,
  });
}
