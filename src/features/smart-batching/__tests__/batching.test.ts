import { describe, expect, it } from "vitest";

import {
  parsePastedEmails,
  partitionIntoBatches,
} from "@/features/smart-batching/batching";

describe("partitionIntoBatches", () => {
  it.each([
    [1, 50, [1]],
    [49, 50, [49]],
    [50, 50, [50]],
    [51, 50, [50, 1]],
    [100, 50, [50, 50]],
    [101, 50, [50, 50, 1]],
    [300, 50, [50, 50, 50, 50, 50, 50]],
    [1000, 50, Array(20).fill(50)],
    [300, 25, Array(12).fill(25)],
    [300, 75, [75, 75, 75, 75]],
    [300, 100, [100, 100, 100]],
    [275, 50, [50, 50, 50, 50, 50, 25]],
  ])(
    "partitions %i contacts with size %i",
    (count, size, expectedSizes) => {
      const values = Array.from({ length: count }, (_, index) => index + 1);
      const batches = partitionIntoBatches(values, size);
      expect(batches.map((batch) => batch.length)).toEqual(expectedSizes);
      expect(batches.flat()).toEqual(values);
    },
  );

  it("does not mutate or deduplicate canonical input ordering", () => {
    const contacts = ["a", "b", "a", "c"];
    expect(partitionIntoBatches(contacts, 2)).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
    expect(contacts).toEqual(["a", "b", "a", "c"]);
  });

  it.each([0, -1, 1.5, 1001])("rejects invalid batch size %s", (size) => {
    expect(() => partitionIntoBatches([1], size)).toThrow(RangeError);
  });
});

describe("parsePastedEmails", () => {
  it("supports line, comma, and semicolon separated addresses", () => {
    expect(
      parsePastedEmails(
        "john@example.com\nmary@example.com, david@example.com;sam@example.com",
      ),
    ).toEqual({
      emails: [
        "john@example.com",
        "mary@example.com",
        "david@example.com",
        "sam@example.com",
      ],
      total: 4,
      duplicates: 0,
      invalid: 0,
    });
  });

  it("normalizes duplicate comparison and reports invalid entries", () => {
    expect(
      parsePastedEmails(
        "John@example.com; john@example.com; invalid; Mary Jones <mary@example.com>",
      ),
    ).toEqual({
      emails: ["John@example.com", "mary@example.com"],
      total: 4,
      duplicates: 1,
      invalid: 1,
    });
  });
});
