import { createClient } from "@/lib/supabase/server";

export type DashboardMetrics = {
  totalContacts: number;
  totalCampaigns: number;
  emailsSent: number;
  successfulEmails: number;
  failedEmails: number;
  smartBatches: number;
  activeSmartBatches: number;
};

const emptyMetrics: DashboardMetrics = {
  totalContacts: 0,
  totalCampaigns: 0,
  emailsSent: 0,
  successfulEmails: 0,
  failedEmails: 0,
  smartBatches: 0,
  activeSmartBatches: 0,
};

export async function getDashboardMetrics(userId: string): Promise<{
  metrics: DashboardMetrics;
  error?: string;
}> {
  const supabase = await createClient();

  const [
    contactsResult,
    campaignsResult,
    sentResult,
    successfulResult,
    failedResult,
    batchesResult,
    activeBatchesResult,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("campaigns")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("sent_at", "is", null),
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "sent"),
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["failed", "bounced"]),
    supabase
      .from("contact_batches")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("contact_batches")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["scheduled", "processing", "paused"]),
  ]);

  const firstError =
    contactsResult.error ||
    campaignsResult.error ||
    sentResult.error ||
    successfulResult.error ||
    failedResult.error;

  if (firstError) {
    // Tables may not exist yet before migrations are applied.
    return {
      metrics: emptyMetrics,
      error:
        firstError.code === "42P01" || firstError.message.includes("does not exist")
          ? "Database tables are not available yet. Apply the Supabase migration, then refresh."
          : "Unable to load dashboard metrics right now.",
    };
  }

  const batchesMissing =
    batchesResult.error?.code === "42P01" ||
    batchesResult.error?.code === "PGRST205" ||
    activeBatchesResult.error?.code === "42P01" ||
    activeBatchesResult.error?.code === "PGRST205";

  return {
    metrics: {
      totalContacts: contactsResult.count ?? 0,
      totalCampaigns: campaignsResult.count ?? 0,
      emailsSent: sentResult.count ?? 0,
      successfulEmails: successfulResult.count ?? 0,
      failedEmails: failedResult.count ?? 0,
      smartBatches: batchesMissing ? 0 : (batchesResult.count ?? 0),
      activeSmartBatches: batchesMissing
        ? 0
        : (activeBatchesResult.count ?? 0),
    },
  };
}

export type DayTracker = {
  sent24h: number;
  failed24h: number;
  queuedNow: number;
  peakHourLabel: string;
  peakHourCount: number;
  streakDays: number;
};

const emptyTracker: DayTracker = {
  sent24h: 0,
  failed24h: 0,
  queuedNow: 0,
  peakHourLabel: "—",
  peakHourCount: 0,
  streakDays: 0,
};

export async function getDayTracker(userId: string): Promise<DayTracker> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const streakStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [sentResult, failedResult, queuedResult, recentSends] = await Promise.all([
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "sent")
      .gte("sent_at", since),
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["failed", "bounced"])
      .gte("failed_at", since),
    supabase
      .from("campaign_recipients")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["pending", "queued", "sending"]),
    supabase
      .from("campaign_recipients")
      .select("sent_at")
      .eq("user_id", userId)
      .eq("status", "sent")
      .gte("sent_at", streakStart)
      .order("sent_at", { ascending: false })
      .limit(5000),
  ]);

  if (sentResult.error || recentSends.error) {
    return emptyTracker;
  }

  const hours = new Array<number>(24).fill(0);
  const sentDays = new Set<string>();
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const row of recentSends.data ?? []) {
    if (!row.sent_at) continue;
    const at = new Date(row.sent_at).getTime();
    if (Number.isNaN(at)) continue;
    sentDays.add(new Date(at).toISOString().slice(0, 10));
    if (now - at <= dayMs) {
      hours[new Date(at).getUTCHours()] += 1;
    }
  }

  let peakHour = 0;
  let peakCount = 0;
  hours.forEach((count, hour) => {
    if (count > peakCount) {
      peakCount = count;
      peakHour = hour;
    }
  });

  let streak = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!sentDays.has(cursor.toISOString().slice(0, 10))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  while (sentDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const peakLabel =
    peakCount === 0
      ? "No sends yet"
      : `${String(peakHour).padStart(2, "0")}:00–${String(peakHour).padStart(2, "0")}:59 UTC`;

  return {
    sent24h: sentResult.count ?? 0,
    failed24h: failedResult.error ? 0 : (failedResult.count ?? 0),
    queuedNow: queuedResult.error ? 0 : (queuedResult.count ?? 0),
    peakHourLabel: peakLabel,
    peakHourCount: peakCount,
    streakDays: streak,
  };
}
