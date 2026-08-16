export const DEFAULT_BATCH_SIZE = 50;
export const MIN_BATCH_SIZE = 1;
export const MAX_BATCH_SIZE = 1000;

export function partitionIntoBatches<T>(
  items: readonly T[],
  batchSize = DEFAULT_BATCH_SIZE,
): T[][] {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < MIN_BATCH_SIZE ||
    batchSize > MAX_BATCH_SIZE
  ) {
    throw new RangeError(
      `Batch size must be an integer from ${MIN_BATCH_SIZE} to ${MAX_BATCH_SIZE}.`,
    );
  }

  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

const EMAIL_IN_TEXT = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
const VALID_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parsePastedEmails(text: string): {
  emails: string[];
  total: number;
  duplicates: number;
  invalid: number;
} {
  const values = text
    .split(/[\r\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const emails: string[] = [];
  let duplicates = 0;
  let invalid = 0;

  for (const value of values) {
    const email = EMAIL_IN_TEXT.exec(value)?.[0] ?? value;
    const normalized = email.toLowerCase();
    if (!VALID_EMAIL.test(email) || email.length > 320) {
      invalid++;
    } else if (seen.has(normalized)) {
      duplicates++;
    } else {
      seen.add(normalized);
      emails.push(email);
    }
  }

  return { emails, total: values.length, duplicates, invalid };
}
