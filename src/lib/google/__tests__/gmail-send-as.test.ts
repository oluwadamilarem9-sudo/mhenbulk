import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSendAsInventory,
  filterUsableGmailSendAs,
  findUsableGmailSendAs,
  GmailSendAsError,
  isUsableGmailSendAs,
  listGmailSendAsIdentities,
  listGmailSendAsIdentitiesWithStatus,
  normalizeVerificationStatus,
  parseGmailSendAsIdentity,
  primarySendAsFallback,
} from "@/lib/google/gmail-send-as";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gmail send-as helpers", () => {
  it("parses Account A primary + verified domain alias from the Gmail API", async () => {
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

    const listed = await listGmailSendAsIdentitiesWithStatus("token-account-a");
    expect(listed.httpStatus).toBe(200);
    expect(listed.identities).toHaveLength(3);
    const usable = filterUsableGmailSendAs(listed.identities);
    expect(usable.map((item) => item.email)).toEqual([
      "aisunnyvid@gmail.com",
      "info@mhenexpert.com",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer token-account-a" },
    });
  });

  it("keeps Account B aliases isolated from Account A", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sendAs: [
            {
              sendAsEmail: "aisunnyvid@gmail.com",
              isPrimary: true,
              isDefault: true,
            },
            {
              sendAsEmail: "info@mhenexpert.com",
              verificationStatus: "accepted",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sendAs: [
            {
              sendAsEmail: "other@gmail.com",
              isPrimary: true,
              isDefault: true,
            },
            {
              sendAsEmail: "sales@otherdomain.com",
              verificationStatus: "accepted",
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const accountA = await listGmailSendAsIdentities("token-a");
    const accountB = await listGmailSendAsIdentities("token-b");

    const usableA = filterUsableGmailSendAs(accountA);
    const usableB = filterUsableGmailSendAs(accountB);

    expect(usableA.map((item) => item.email)).toEqual([
      "aisunnyvid@gmail.com",
      "info@mhenexpert.com",
    ]);
    expect(usableB.map((item) => item.email)).toEqual([
      "other@gmail.com",
      "sales@otherdomain.com",
    ]);
    expect(usableB.some((item) => item.email === "info@mhenexpert.com")).toBe(
      false,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer token-a" },
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer token-b" },
    });
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

  it("handles verificationStatus values with inventory labels", () => {
    const inventory = buildSendAsInventory([
      parseGmailSendAsIdentity({
        sendAsEmail: "aisunnyvid@gmail.com",
        isPrimary: true,
      })!,
      parseGmailSendAsIdentity({
        sendAsEmail: "info@mhenexpert.com",
        verificationStatus: "ACCEPTED",
      })!,
      parseGmailSendAsIdentity({
        sendAsEmail: "pending@mhenexpert.com",
        verificationStatus: "pending",
      })!,
      parseGmailSendAsIdentity({
        sendAsEmail: "failed@mhenexpert.com",
        verificationStatus: "failed",
      })!,
      parseGmailSendAsIdentity({
        sendAsEmail: "weird@mhenexpert.com",
        verificationStatus: "something_else",
      })!,
    ]);

    expect(normalizeVerificationStatus("verificationStatus_accepted")).toBe(
      "accepted",
    );
    expect(
      inventory.find((item) => item.email === "info@mhenexpert.com"),
    ).toMatchObject({
      usable: true,
      statusLabel: "Verified and available",
    });
    expect(
      inventory.find((item) => item.email === "pending@mhenexpert.com"),
    ).toMatchObject({
      usable: false,
      statusLabel: "Verification pending in Gmail",
      exclusionReason: "verification_pending",
    });
    expect(
      inventory.find((item) => item.email === "failed@mhenexpert.com"),
    ).toMatchObject({
      usable: false,
      statusLabel: "Verification rejected in Gmail",
      exclusionReason: "verification_rejected",
    });
    expect(
      inventory.find((item) => item.email === "weird@mhenexpert.com"),
    ).toMatchObject({
      usable: false,
      exclusionReason: "verification_unknown",
    });
    expect(
      findUsableGmailSendAs(
        inventory.map((item) =>
          parseGmailSendAsIdentity({
            sendAsEmail: item.email,
            isPrimary: item.isPrimary,
            verificationStatus: item.verificationStatus ?? undefined,
          })!,
        ),
        "pending@mhenexpert.com",
      ),
    ).toBeNull();
  });

  it("surfaces Gmail API access failures distinctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () =>
          JSON.stringify({ error: { message: "Insufficient Permission" } }),
      }),
    );

    await expect(listGmailSendAsIdentities("token")).rejects.toBeInstanceOf(
      GmailSendAsError,
    );
    try {
      await listGmailSendAsIdentities("token");
    } catch (error) {
      expect(error).toBeInstanceOf(GmailSendAsError);
      if (error instanceof GmailSendAsError) {
        expect(error.code).toBe("forbidden");
        expect(error.status).toBe(403);
        expect(error.message).toMatch(/gmail\.modify|insufficient|send-as/i);
      }
    }
  });

  it("rejects unverified aliases for sending", () => {
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
    expect(
      findUsableGmailSendAs([verified!, pending!], "INFO@mhenexpert.com")?.email,
    ).toBe("info@mhenexpert.com");
    expect(
      findUsableGmailSendAs([verified!, pending!], "pending@mhenexpert.com"),
    ).toBeNull();
  });
});
