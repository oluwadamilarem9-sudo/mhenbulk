import { z } from "zod";

import { parseDelimited } from "@/features/contacts/csv";

export const cleanerStatusValues = [
  "VALID",
  "CORRECTED",
  "DUPLICATE",
  "INVALID",
  "SUSPICIOUS",
  "REVIEW_REQUIRED",
] as const;

export type CleanerStatus = (typeof cleanerStatusValues)[number];

export type CleanerInputRecord = {
  rowIndex: number;
  originalEmail: string;
  extra: Record<string, string>;
};

export type CleanerOutputRecord = {
  rowIndex: number;
  originalEmail: string;
  cleanEmail: string | null;
  status: CleanerStatus;
  issue: string;
  suggestedCorrection: string | null;
  confidence: number | null;
  extra: Record<string, string>;
};

const emailSchema = z.string().email();
const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const commonDomainTypos: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmail.co": "gmail.com",
  "yaho.com": "yahoo.com",
  "hotnail.com": "hotmail.com",
  "outlok.com": "outlook.com",
};

export function extractFirstEmail(text: string): string {
  const match = text.match(emailPattern);
  return match?.[0] ?? "";
}

function safeNormalize(raw: string): { value: string; changed: string[] } {
  let value = raw;
  const changed: string[] = [];
  const trimmed = value.trim();
  if (trimmed !== value) changed.push("Trimmed surrounding whitespace");
  value = trimmed;

  const noInternal = value.replace(/\s*@\s*/g, "@").replace(/\s+/g, "");
  if (noInternal !== value) changed.push("Removed whitespace around email");
  value = noInternal;

  const stripped = value.replace(/[.,;:]+$/g, "");
  if (stripped !== value) changed.push("Removed trailing punctuation");
  value = stripped;

  const lowered = value.toLowerCase();
  if (lowered !== value) changed.push("Lowercased");
  value = lowered;

  return { value, changed };
}

function maybeSuggestDomainTypo(email: string): {
  suggested: string | null;
  confidence: number | null;
  issue: string | null;
} {
  const parts = email.split("@");
  if (parts.length !== 2) return { suggested: null, confidence: null, issue: null };
  const [local, domain] = parts;
  const replacement = commonDomainTypos[domain];
  if (!replacement) return { suggested: null, confidence: null, issue: null };
  return {
    suggested: `${local}@${replacement}`,
    confidence: 0.95,
    issue: "Possible domain typo",
  };
}

export function cleanOneRecord(record: CleanerInputRecord): CleanerOutputRecord {
  const extracted = extractFirstEmail(record.originalEmail) || record.originalEmail;
  const normalized = safeNormalize(extracted);

  if (!normalized.value) {
    return {
      rowIndex: record.rowIndex,
      originalEmail: record.originalEmail,
      cleanEmail: null,
      status: "INVALID",
      issue: "No email detected",
      suggestedCorrection: null,
      confidence: null,
      extra: record.extra,
    };
  }

  const valid = emailSchema.safeParse(normalized.value).success;
  if (!valid) {
    return {
      rowIndex: record.rowIndex,
      originalEmail: record.originalEmail,
      cleanEmail: null,
      status: "INVALID",
      issue: "Invalid email format",
      suggestedCorrection: null,
      confidence: null,
      extra: record.extra,
    };
  }

  const typo = maybeSuggestDomainTypo(normalized.value);
  if (typo.suggested) {
    return {
      rowIndex: record.rowIndex,
      originalEmail: record.originalEmail,
      cleanEmail: normalized.value,
      status: "REVIEW_REQUIRED",
      issue: typo.issue ?? "Needs review",
      suggestedCorrection: typo.suggested,
      confidence: typo.confidence,
      extra: record.extra,
    };
  }

  return {
    rowIndex: record.rowIndex,
    originalEmail: record.originalEmail,
    cleanEmail: normalized.value,
    status: normalized.changed.length > 0 ? "CORRECTED" : "VALID",
    issue: normalized.changed.length > 0 ? normalized.changed.join(", ") : "Format valid",
    suggestedCorrection: null,
    confidence: null,
    extra: record.extra,
  };
}

export function markDuplicates(
  rows: CleanerOutputRecord[],
  keepMode: "first" | "last",
): CleanerOutputRecord[] {
  const byEmail = new Map<string, number[]>();
  rows.forEach((row, i) => {
    if (!row.cleanEmail) return;
    const key = row.cleanEmail.toLowerCase();
    byEmail.set(key, [...(byEmail.get(key) ?? []), i]);
  });

  for (const indexes of byEmail.values()) {
    if (indexes.length < 2) continue;
    const keepIndex = keepMode === "first" ? indexes[0] : indexes[indexes.length - 1];
    for (const idx of indexes) {
      if (idx === keepIndex) continue;
      if (rows[idx].status === "INVALID") continue;
      rows[idx] = {
        ...rows[idx],
        status: "DUPLICATE",
        issue: "Duplicate email",
      };
    }
  }

  return rows;
}

export function parsePastedEmails(input: string): CleanerInputRecord[] {
  const chunks = input
    .split(/\r?\n|,|;/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return chunks.map((value, index) => ({
    rowIndex: index + 1,
    originalEmail: value,
    extra: {},
  }));
}

export function parseCsvForCleaner(
  text: string,
  emailColumn?: string,
): {
  records: CleanerInputRecord[];
  headers: string[];
  candidateEmailColumns: string[];
  needsColumnSelection: boolean;
} {
  const rows = parseDelimited(text, ",");
  if (rows.length === 0) {
    return { records: [], headers: [], candidateEmailColumns: [], needsColumnSelection: false };
  }
  const headers = rows[0].map((h) => h.trim());
  const lowered = headers.map((h) => h.toLowerCase());

  const candidates = headers.filter((h, idx) => {
    if (lowered[idx].includes("email") || lowered[idx] === "mail") return true;
    const sample = rows.slice(1, 20).map((r) => r[idx] ?? "");
    const hit = sample.filter((v) => Boolean(extractFirstEmail(v))).length;
    return hit >= Math.max(2, Math.ceil(sample.length / 4));
  });

  const chosen =
    emailColumn && headers.includes(emailColumn)
      ? emailColumn
      : candidates.length === 1
        ? candidates[0]
        : null;

  if (!chosen) {
    return {
      records: [],
      headers,
      candidateEmailColumns: candidates,
      needsColumnSelection: true,
    };
  }

  const emailIndex = headers.indexOf(chosen);
  const records: CleanerInputRecord[] = rows.slice(1).map((row, i) => {
    const extra: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (idx === emailIndex) return;
      extra[h] = (row[idx] ?? "").trim();
    });
    return {
      rowIndex: i + 1,
      originalEmail: (row[emailIndex] ?? "").trim(),
      extra,
    };
  });

  return {
    records: records.filter((r) => r.originalEmail.length > 0),
    headers,
    candidateEmailColumns: candidates,
    needsColumnSelection: false,
  };
}

export function toCsv(rows: Array<Record<string, string | null | number>>): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escapeCell = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => escapeCell(String(row[header] ?? "")))
        .join(","),
    ),
  ];
  return lines.join("\n");
}
