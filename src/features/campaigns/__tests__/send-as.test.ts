import { describe, expect, it } from "vitest";

import {
  filterUsableGmailSendAs,
  findUsableGmailSendAs,
  parseGmailSendAsIdentity,
} from "@/lib/google/gmail-send-as";

describe("campaign send-as selection rules", () => {
  const identities = [
    parseGmailSendAsIdentity({
      sendAsEmail: "aisunnyvid@gmail.com",
      displayName: "Sunny",
      isPrimary: true,
      isDefault: true,
    })!,
    parseGmailSendAsIdentity({
      sendAsEmail: "info@mhenexpert.com",
      displayName: "MHEN Expert",
      replyToAddress: "info@mhenexpert.com",
      verificationStatus: "accepted",
    })!,
    parseGmailSendAsIdentity({
      sendAsEmail: "unverified@mhenexpert.com",
      verificationStatus: "pending",
    })!,
  ];

  it("lets a campaign select a verified domain alias", () => {
    const usable = filterUsableGmailSendAs(identities);
    expect(usable.some((item) => item.email === "info@mhenexpert.com")).toBe(true);
    expect(findUsableGmailSendAs(identities, "info@mhenexpert.com")).toMatchObject({
      email: "info@mhenexpert.com",
      displayName: "MHEN Expert",
      replyToAddress: "info@mhenexpert.com",
    });
  });

  it("rejects arbitrary From addresses that are not verified on the account", () => {
    expect(findUsableGmailSendAs(identities, "spoof@evil.com")).toBeNull();
    expect(
      findUsableGmailSendAs(identities, "unverified@mhenexpert.com"),
    ).toBeNull();
  });

  it("keeps the same selected sender identity for retries", () => {
    const selected = "info@mhenexpert.com";
    const first = findUsableGmailSendAs(identities, selected);
    const retry = findUsableGmailSendAs(identities, selected);
    expect(first?.email).toBe(selected);
    expect(retry?.email).toBe(first?.email);
  });

  it("prevents cross-account alias use by requiring membership in that account list", () => {
    const otherAccountAliases = filterUsableGmailSendAs([
      parseGmailSendAsIdentity({
        sendAsEmail: "other@gmail.com",
        isPrimary: true,
      })!,
    ]);
    expect(
      otherAccountAliases.some((item) => item.email === "info@mhenexpert.com"),
    ).toBe(false);
  });
});
