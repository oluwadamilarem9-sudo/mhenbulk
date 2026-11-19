import { describe, expect, it } from "vitest";

import { sanitizeEmailPreview } from "@/features/gmail-cleaner/sanitize-preview";

describe("sanitizeEmailPreview", () => {
  it("strips scripts and tags", () => {
    const preview = sanitizeEmailPreview(
      `<script>alert(1)</script><p>Hello <b>Ada</b></p>`,
    );
    expect(preview).toBe("Hello Ada");
    expect(preview.toLowerCase()).not.toContain("script");
  });
});
