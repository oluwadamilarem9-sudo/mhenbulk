import { describe, expect, it } from "vitest";

import {
  GMAIL_MODIFY_SCOPE,
  GMAIL_SEND_SCOPE,
  gmailAliasReconnectPath,
  gmailScopesString,
  hasGmailModifyScope,
  hasGmailSendAsListScope,
  mergeGoogleScopes,
  normalizeGoogleScopes,
} from "@/lib/google/scopes";

describe("gmail scopes helpers", () => {
  it("keeps send-only authorization without gmail.modify", () => {
    expect(gmailScopesString("send")).toContain(GMAIL_SEND_SCOPE);
    expect(gmailScopesString("send")).not.toContain(GMAIL_MODIFY_SCOPE);
    expect(
      hasGmailSendAsListScope([
        "https://www.googleapis.com/auth/gmail.send",
        "openid",
      ]),
    ).toBe(false);
  });

  it("requests gmail.modify for cleaner and aliases intents", () => {
    expect(gmailScopesString("cleaner")).toContain(GMAIL_MODIFY_SCOPE);
    expect(gmailScopesString("aliases")).toContain(GMAIL_MODIFY_SCOPE);
    expect(gmailScopesString("aliases")).toContain(GMAIL_SEND_SCOPE);
    expect(hasGmailModifyScope([GMAIL_MODIFY_SCOPE])).toBe(true);
  });

  it("persists merged scopes so incremental consent keeps modify", () => {
    const merged = mergeGoogleScopes(
      [GMAIL_SEND_SCOPE, GMAIL_MODIFY_SCOPE],
      [GMAIL_SEND_SCOPE, "openid"],
    );
    expect(hasGmailModifyScope(merged)).toBe(true);
    expect(hasGmailSendAsListScope(merged)).toBe(true);
    expect(merged).toContain(GMAIL_SEND_SCOPE);
  });

  it("treats refresh-token scope strings as authoritative when present", () => {
    const fromRefresh = normalizeGoogleScopes(
      "https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/gmail.modify",
    );
    expect(hasGmailSendAsListScope(fromRefresh)).toBe(true);
    expect(
      hasGmailSendAsListScope(
        normalizeGoogleScopes(
          "openid https://www.googleapis.com/auth/gmail.send",
        ),
      ),
    ).toBe(false);
  });

  it("isolates send-as list capability across accounts with different scopes", () => {
    const accountA = [
      "https://www.googleapis.com/auth/gmail.send",
      GMAIL_MODIFY_SCOPE,
    ];
    const accountB = ["https://www.googleapis.com/auth/gmail.send"];
    expect(hasGmailSendAsListScope(accountA)).toBe(true);
    expect(hasGmailSendAsListScope(accountB)).toBe(false);
  });

  it("builds an aliases reconnect path with the aliases intent", () => {
    expect(gmailAliasReconnectPath("/campaigns/new")).toBe(
      "/api/auth/google/start?intent=aliases&returnTo=%2Fcampaigns%2Fnew",
    );
  });
});
