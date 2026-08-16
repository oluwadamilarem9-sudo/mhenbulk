import { describe, expect, it } from "vitest";

import { parseContactsFile } from "@/features/contacts/csv";

describe("parseContactsFile", () => {
  it("uses named columns when a header row is present", () => {
    const result = parseContactsFile(
      "first_name,last_name,email,company\nAda,Lovelace,ada@example.com,Analytical",
      "contacts.csv",
    );

    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      company: "Analytical",
    });
  });

  it("detects the email column when the header does not name it", () => {
    const result = parseContactsFile(
      "Contact,Work E-Mail Address\nAda,ada@example.com\nGrace,grace@example.com",
      "contacts.csv",
    );

    expect(result.error).toBeUndefined();
    expect(result.rows.map((row) => row.email)).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
  });

  it("imports multi-column files with no header row", () => {
    const result = parseContactsFile(
      "Ada,Analytical,ada@example.com\nGrace,Navy,grace@example.com",
      "contacts.csv",
    );

    expect(result.error).toBeUndefined();
    expect(result.rows.map((row) => row.email)).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
  });

  it("imports headerless single-column files", () => {
    const result = parseContactsFile(
      "ada@example.com\ngrace@example.com",
      "contacts.csv",
    );

    expect(result.rows.map((row) => row.email)).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
  });

  it("splits a single name column into first and last name", () => {
    const result = parseContactsFile(
      "Name,Email\nAda Byron Lovelace,ada@example.com",
      "contacts.csv",
    );

    expect(result.rows[0]).toMatchObject({
      first_name: "Ada Byron",
      last_name: "Lovelace",
      email: "ada@example.com",
    });
  });

  it("extracts addresses wrapped in display names", () => {
    const result = parseContactsFile(
      "Ada Lovelace <ada@example.com>\ngrace@example.com",
      "contacts.txt",
    );

    expect(result.rows.map((row) => row.email)).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
  });

  it("reports a clear error when no addresses exist", () => {
    const result = parseContactsFile("name,company\nAda,Analytical", "contacts.csv");

    expect(result.rows).toHaveLength(0);
    expect(result.error).toContain("couldn't find any email addresses");
  });
});
