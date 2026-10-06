/**
 * App-side daily cap while warm-up is on and no manual limit is set.
 * After 14 days the app stops capping; Gmail's own quota still applies.
 *
 * Week 1: 200/day
 * Week 2: 300/day
 * After that: no app cap
 */
export function warmupDailyLimit(warmupStartDate: string): number | null {
  const start = new Date(warmupStartDate).getTime();
  if (Number.isNaN(start)) return null;

  const days = Math.floor((Date.now() - start) / 86_400_000);
  if (days < 7) return 200;
  if (days < 14) return 300;
  return null;
}

export function warmupStageLabel(warmupStartDate: string): string {
  const limit = warmupDailyLimit(warmupStartDate);
  if (limit === 200) return "Week 1 — 200/day";
  if (limit === 300) return "Week 2 — 300/day";
  return "Warm-up complete — no app daily cap";
}

/**
 * A number the user typed is the cap.
 * Warm-up only applies when that field is blank.
 */
export function effectiveDailySendLimit(account: {
  daily_send_limit: number | null;
  warmup_enabled: boolean;
  warmup_start_date: string | null;
}): number | null {
  if (account.daily_send_limit != null) {
    return account.daily_send_limit;
  }
  if (account.warmup_enabled && account.warmup_start_date) {
    return warmupDailyLimit(account.warmup_start_date);
  }
  return null;
}
