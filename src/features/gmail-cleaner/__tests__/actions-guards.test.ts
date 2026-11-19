import { describe, expect, it } from "vitest";

import {
  restoreGmailCleanerItemsAction,
  trashSelectedGmailMessagesAction,
} from "@/features/gmail-cleaner/actions";

describe("gmail cleaner action guards", () => {
  it("rejects cleanup without explicit confirmation", async () => {
    const result = await trashSelectedGmailMessagesAction(
      "11111111-1111-4111-8111-111111111111",
      false,
    );
    expect(result.error).toMatch(/confirm/i);
  });

  it("rejects restore with invalid ids", async () => {
    const result = await restoreGmailCleanerItemsAction("not-a-uuid", ["also-bad"]);
    expect(result.error).toBeTruthy();
  });
});
