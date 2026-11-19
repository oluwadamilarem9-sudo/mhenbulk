import { describe, expect, it } from "vitest";

import {
  GMAIL_MODIFY_SCOPE,
  GMAIL_SEND_SCOPE,
  hasGmailModifyScope,
  mergeGoogleScopes,
  gmailScopesString,
} from "@/lib/google/scopes";

describe("gmail scopes helpers", () => {
  it("requests modify only for cleaner intent", () => {
    expect(gmailScopesString("send")).not.toContain(GMAIL_MODIFY_SCOPE);
    expect(gmailScopesString("cleaner")).toContain(GMAIL_MODIFY_SCOPE);
    expect(gmailScopesString("cleaner")).toContain(GMAIL_SEND_SCOPE);
  });

  it("merges scopes so send reconnect cannot drop modify", () => {
    const merged = mergeGoogleScopes(
      [GMAIL_SEND_SCOPE, GMAIL_MODIFY_SCOPE],
      [GMAIL_SEND_SCOPE, "openid"],
    );
    expect(hasGmailModifyScope(merged)).toBe(true);
    expect(merged).toContain(GMAIL_SEND_SCOPE);
  });
});
