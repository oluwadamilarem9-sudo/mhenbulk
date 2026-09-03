import { describe, expect, it } from "vitest";

import {
  appendOpenTrackPixel,
  createOpenTrackToken,
  verifyOpenTrackToken,
} from "@/lib/email/open-track";

describe("open-track", () => {
  it("round-trips a signed recipient token", () => {
    process.env.UNSUBSCRIBE_SECRET = "x".repeat(32);
    const id = "11111111-1111-4111-8111-111111111111";
    const token = createOpenTrackToken(id);
    expect(verifyOpenTrackToken(token)).toBe(id);
    expect(verifyOpenTrackToken("bad.token")).toBeNull();
  });

  it("appends a hidden tracking pixel", () => {
    process.env.UNSUBSCRIBE_SECRET = "x".repeat(32);
    process.env.NEXT_PUBLIC_APP_URL = "https://mhenbulk.vercel.app";
    const id = "11111111-1111-4111-8111-111111111111";
    const html = appendOpenTrackPixel("<p>Hello</p>", id);
    expect(html).toContain("/api/t/o?t=");
    expect(html).toContain('width="1"');
  });
});
