import { describe, expect, it } from "vitest";

import {
  buildPinnedLookupRecords,
  pinnedLookupCallback,
} from "@/features/email-finder/safe-fetch";
import {
  SafeUrlError,
  isBlockedIpAddress,
  validatePublicHttpUrl,
} from "@/features/email-finder/url-security";

describe("DNS pinning callback", () => {
  it("returns an address array when Node asks for all records", () => {
    const records = buildPinnedLookupRecords([
      "2620:127:f00f:5::",
      "23.227.38.65",
    ]);
    expect(records[0].family).toBe(4);

    let received: unknown;
    pinnedLookupCallback(records, { all: true }, (_error, value) => {
      received = value;
    });
    expect(Array.isArray(received)).toBe(true);
    expect(received).toEqual(records);
  });

  it("returns a single address when all is false", () => {
    const records = buildPinnedLookupRecords(["23.227.38.65"]);
    let address: unknown;
    let family: unknown;
    pinnedLookupCallback(records, {}, (_error, value, nextFamily) => {
      address = value;
      family = nextFamily;
    });
    expect(address).toBe("23.227.38.65");
    expect(family).toBe(4);
  });
});

describe("IPv6 literal hardening", () => {
  it("blocks bracketed loopback and metadata addresses", async () => {
    expect(isBlockedIpAddress("::1")).toBe(true);
    expect(isBlockedIpAddress("fd00:ec2::254")).toBe(true);

    await expect(validatePublicHttpUrl("http://[::1]/")).rejects.toMatchObject({
      name: "SafeUrlError",
      code: "private_address",
    } satisfies Partial<SafeUrlError>);

    await expect(
      validatePublicHttpUrl("http://[fd00:ec2::254]/"),
    ).rejects.toMatchObject({
      code: "private_address",
    });
  });
});
