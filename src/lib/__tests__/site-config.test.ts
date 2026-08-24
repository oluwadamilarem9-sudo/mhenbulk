import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUPPORT_EMAIL,
  getSupportEmail,
  GOVERNING_LAW_NOTICE,
  LEGAL_LAST_UPDATED,
  SITE_NAME,
} from "@/lib/site-config";

describe("legal site config", () => {
  it("exposes branding and last updated date", () => {
    expect(SITE_NAME).toBe("Mhenbulk");
    expect(LEGAL_LAST_UPDATED.length).toBeGreaterThan(0);
  });

  it("uses the configured support email without placeholders", () => {
    expect(getSupportEmail()).toBe(DEFAULT_SUPPORT_EMAIL);
    expect(getSupportEmail()).not.toMatch(/\[REPLACE/);
  });

  it("uses a neutral governing law notice", () => {
    expect(GOVERNING_LAW_NOTICE).not.toMatch(/\[REPLACE/);
    expect(GOVERNING_LAW_NOTICE.toLowerCase()).not.toContain("nigeria");
  });
});
