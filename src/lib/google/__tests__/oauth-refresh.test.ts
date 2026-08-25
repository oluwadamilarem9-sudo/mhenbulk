import { describe, expect, it } from "vitest";

import { classifyGoogleTokenRefreshFailure } from "@/lib/google/oauth";

describe("classifyGoogleTokenRefreshFailure", () => {
  it("treats invalid_grant as auth_required", () => {
    expect(
      classifyGoogleTokenRefreshFailure(
        400,
        '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}',
      ),
    ).toBe("auth_required");
  });

  it("treats Google 503 as transient", () => {
    expect(
      classifyGoogleTokenRefreshFailure(503, "Service Unavailable"),
    ).toBe("transient");
  });

  it("treats rate limiting as transient", () => {
    expect(
      classifyGoogleTokenRefreshFailure(
        429,
        '{"error":"rate_limit_exceeded"}',
      ),
    ).toBe("transient");
  });
});
