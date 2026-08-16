import { describe, expect, it } from "vitest";

import { validatePublicHttpUrl, SafeUrlError } from "@/features/email-finder/url-security";

describe("validatePublicHttpUrl", () => {
  it("accepts https urls and normalizes bare hosts", async () => {
    const https = await validatePublicHttpUrl("https://example.com/contact");
    expect(https.hostname).toBe("example.com");
    expect(https.pathname).toBe("/contact");
    expect(https.addresses.length).toBeGreaterThan(0);

    const bare = await validatePublicHttpUrl("example.com");
    expect(bare.href.startsWith("https://example.com")).toBe(true);
  });

  it("rejects dangerous protocols and localhost", async () => {
    await expect(validatePublicHttpUrl("javascript:alert(1)")).rejects.toBeInstanceOf(
      SafeUrlError,
    );
    await expect(validatePublicHttpUrl("file:///etc/passwd")).rejects.toBeInstanceOf(
      SafeUrlError,
    );
    await expect(validatePublicHttpUrl("http://localhost")).rejects.toBeInstanceOf(
      SafeUrlError,
    );
    await expect(validatePublicHttpUrl("http://127.0.0.1")).rejects.toBeInstanceOf(
      SafeUrlError,
    );
    await expect(validatePublicHttpUrl("http://169.254.169.254")).rejects.toBeInstanceOf(
      SafeUrlError,
    );
    await expect(validatePublicHttpUrl("http://192.168.0.1")).rejects.toBeInstanceOf(
      SafeUrlError,
    );
  });
});
