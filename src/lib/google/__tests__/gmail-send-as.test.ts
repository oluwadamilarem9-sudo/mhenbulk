import { afterEach, describe, expect, it, vi } from "vitest";

import {
  filterUsableGmailSendAs,
  findUsableGmailSendAs,
  isUsableGmailSendAs,
  listGmailSendAsIdentities,
  parseGmailSendAsIdentity,
  primarySendAsFallback,
} from "@/lib/google/gmail-send-as";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gmail send-as helpers", () => {
  it("parses multiple send-as aliases from the Gmail API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sendAs: [
          {
            sendAsEmail: "aisunnyvid@gmail.com",
            displayName: "Sunny",
            isPrimary: true,
            isDefault: true,
          },
          {
            sendAsEmail: "info@mhenexpert.com",
            displayName: "MHEN Expert",
            replyToAddress: "info@mhenexpert.com",
            isPrimary: false,
            isDefault: false,
            verificationStatus: "accepted",
          },
          {
            sendAsEmail: "pending@mhenexpert.com",
            verificationStatus: "pending",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const identities = await listGmailSendAsIdentities("token");
    expect(identities).toHaveLength(3);
    const usable = filterUsableGmailSendAs(identities);
    expect(usable.map((item) => item.email)).toEqual([
      "aisunnyvid@gmail.com",
      "info@mhenexpert.com",
    ]);
  });

  it("treats the primary Gmail address as always usable", () => {
    const primary = parseGmailSendAsIdentity({
      sendAsEmail: "aisunnyvid@gmail.com",
      isPrimary: true,
      isDefault: true,
    });
    expect(primary).not.toBeNull();
    expect(isUsableGmailSendAs(primary!)).toBe(true);
    expect(primarySendAsFallback("Aisunnyvid@gmail.com", "Sunny").email).toBe(
      "aisunnyvid@gmail.com",
    );
  });

  it("accepts verified domain aliases and rejects unverified ones", () => {
    const verified = parseGmailSendAsIdentity({
      sendAsEmail: "info@mhenexpert.com",
      verificationStatus: "accepted",
    });
    const pending = parseGmailSendAsIdentity({
      sendAsEmail: "pending@mhenexpert.com",
      verificationStatus: "pending",
    });
    expect(isUsableGmailSendAs(verified!)).toBe(true);
    expect(isUsableGmailSendAs(pending!)).toBe(false);
    expect(findUsableGmailSendAs([verified!, pending!], "INFO@mhenexpert.com")?.email).toBe(
      "info@mhenexpert.com",
    );
    expect(findUsableGmailSendAs([verified!, pending!], "pending@mhenexpert.com")).toBeNull();
  });
});
