import { describe, expect, it } from "vitest";

import {
  effectiveDailySendLimit,
  warmupDailyLimit,
} from "@/lib/email/daily-limit";

describe("daily send limit", () => {
  it("uses a typed limit instead of warm-up", () => {
    expect(
      effectiveDailySendLimit({
        daily_send_limit: 500,
        warmup_enabled: true,
        warmup_start_date: new Date().toISOString().slice(0, 10),
      }),
    ).toBe(500);
  });

  it("allows 300 in week 2 and no app cap after 14 days", () => {
    const start = new Date(Date.now() - 8 * 86_400_000).toISOString();
    expect(warmupDailyLimit(start)).toBe(300);

    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    expect(
      effectiveDailySendLimit({
        daily_send_limit: null,
        warmup_enabled: true,
        warmup_start_date: old,
      }),
    ).toBeNull();
  });
});
