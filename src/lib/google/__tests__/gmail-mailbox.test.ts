import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GmailApiError,
  getGmailMessageMetadataBatch,
  listGmailMessageIds,
  parseFromHeader,
  trashGmailMessage,
} from "@/lib/google/gmail-mailbox";
import {
  GMAIL_MODIFY_SCOPE,
  gmailScopesString,
  hasGmailModifyScope,
} from "@/lib/google/scopes";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gmail mailbox helpers", () => {
  it("requests cleaner/aliases scopes including gmail.modify", () => {
    expect(gmailScopesString("cleaner")).toContain(GMAIL_MODIFY_SCOPE);
    expect(gmailScopesString("aliases")).toContain(GMAIL_MODIFY_SCOPE);
    expect(gmailScopesString("send")).not.toContain(GMAIL_MODIFY_SCOPE);
    expect(hasGmailModifyScope([GMAIL_MODIFY_SCOPE])).toBe(true);
    expect(hasGmailModifyScope(["https://www.googleapis.com/auth/gmail.send"])).toBe(
      false,
    );
  });

  it("paginates message ids and dedupes duplicates in a page", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [{ id: "a" }, { id: "a" }, { id: "b" }],
        nextPageToken: "page-2",
        resultSizeEstimate: 3,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = await listGmailMessageIds("token", {
      includeSpamTrash: true,
      pageSize: 50,
    });

    expect(page.messageIds).toEqual(["a", "b"]);
    expect(page.nextPageToken).toBe("page-2");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("includeSpamTrash=true");
  });

  it("loads metadata with bounded concurrency and collects non-fatal failures", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/messages/bad")) {
        return {
          ok: false,
          status: 404,
          text: async () => "missing",
          headers: new Headers(),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: url.includes("msg-1") ? "msg-1" : "msg-2",
          threadId: "t",
          labelIds: ["INBOX"],
          snippet: "hi",
          sizeEstimate: 10,
          internalDate: "1",
          payload: { headers: [{ name: "Subject", value: "Test" }] },
        }),
        headers: new Headers(),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getGmailMessageMetadataBatch(
      "token",
      ["msg-1", "bad", "msg-2"],
      2,
    );
    expect(result.messages.map((row) => row.id).sort()).toEqual([
      "msg-1",
      "msg-2",
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.id).toBe("bad");
  });

  it("maps rate limits and auth failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
        headers: new Headers(),
      }),
    );

    await expect(trashGmailMessage("token", "msg")).rejects.toMatchObject({
      code: "auth_required",
    } satisfies Partial<GmailApiError>);
  });

  it("parses From headers", () => {
    expect(parseFromHeader(`"Ada Lovelace" <ada@example.com>`)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(parseFromHeader("solo@example.com").email).toBe("solo@example.com");
  });
});
