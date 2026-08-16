/**
 * Delimited-file parser supporting quoted fields, escaped quotes, and CRLF.
 * Handles CSV and TSV without adding a dependency.
 */

/** Spreadsheets often prefix exported files with a UTF-8 byte order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseDelimited(input: string, delimiter = ","): string[][] {
  const text = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      field = "";
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

type ContactFileField =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "company"
  | "phone"
  | "tags"
  | "notes";

const HEADER_ALIASES: Record<string, ContactFileField> = {
  first_name: "first_name",
  firstname: "first_name",
  "first name": "first_name",
  given_name: "first_name",
  "given name": "first_name",
  last_name: "last_name",
  lastname: "last_name",
  "last name": "last_name",
  surname: "last_name",
  family_name: "last_name",
  "family name": "last_name",
  name: "full_name",
  fullname: "full_name",
  full_name: "full_name",
  "full name": "full_name",
  "contact name": "full_name",
  email: "email",
  "email address": "email",
  email_address: "email",
  emailaddress: "email",
  "e-mail": "email",
  "e-mail address": "email",
  mail: "email",
  "work email": "email",
  "business email": "email",
  company: "company",
  organization: "company",
  organisation: "company",
  phone: "phone",
  telephone: "phone",
  "phone number": "phone",
  tags: "tags",
  tag: "tags",
  labels: "tags",
  notes: "notes",
  note: "notes",
};

const EMAIL_IN_TEXT = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

/** Pulls the address out of values like `John Smith <john@example.com>`. */
function extractEmail(value: string): string {
  return EMAIL_IN_TEXT.exec(value.trim())?.[0] ?? "";
}

function looksLikeEmail(value: string): boolean {
  return extractEmail(value) !== "";
}

export type ParsedContactRow = {
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  phone: string;
  tags: string;
  notes: string;
  line: number;
};

export type ParsedContactsFile = {
  rows: ParsedContactRow[];
  error?: string;
};

function emptyRow(line: number): ParsedContactRow {
  return {
    first_name: "",
    last_name: "",
    email: "",
    company: "",
    phone: "",
    tags: "",
    notes: "",
    line,
  };
}

function parsePlainEmailList(input: string): ParsedContactsFile {
  const rows = stripBom(input)
    .split(/\r?\n/)
    .map((value, index) => ({
      ...emptyRow(index + 1),
      email: extractEmail(value) || value.trim(),
    }))
    .filter((row) => row.email !== "" && row.email.toLowerCase() !== "email");

  return rows.length > 0
    ? { rows }
    : { rows: [], error: "The selected file is empty." };
}

/** Splits a single name column so the last word becomes the last name. */
function applyFullName(record: ParsedContactRow, value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return;
  if (parts.length === 1) {
    record.first_name = parts[0];
    return;
  }
  record.last_name = parts[parts.length - 1];
  record.first_name = parts.slice(0, -1).join(" ");
}

function assignField(
  record: ParsedContactRow,
  field: ContactFileField,
  value: string,
) {
  const trimmed = value.trim();
  if (field === "full_name") {
    applyFullName(record, trimmed);
    return;
  }
  if (field === "email") {
    record.email = extractEmail(trimmed) || trimmed;
    return;
  }
  record[field] = trimmed;
}

/** Finds the column that holds email addresses when no header names it. */
function detectEmailColumn(rows: string[][]): number {
  const counts = new Map<number, number>();
  for (const row of rows) {
    row.forEach((value, index) => {
      if (looksLikeEmail(value)) {
        counts.set(index, (counts.get(index) ?? 0) + 1);
      }
    });
  }

  let bestIndex = -1;
  let bestCount = 0;
  for (const [index, count] of counts) {
    if (count > bestCount) {
      bestIndex = index;
      bestCount = count;
    }
  }
  return bestIndex;
}

/**
 * A header row is never required. Named columns are used when present, and
 * otherwise the email column is detected from the data itself. Names, company,
 * phone, tags, and notes are always optional.
 */
export function parseContactsFile(text: string, fileName: string): ParsedContactsFile {
  const extension = fileName.toLowerCase().split(".").pop();

  if (extension === "txt") {
    return parsePlainEmailList(text);
  }

  const delimiter = extension === "tsv" ? "\t" : ",";
  const parsed = parseDelimited(text, delimiter);

  if (parsed.length === 0) {
    return { rows: [], error: "The selected file is empty." };
  }

  const header = parsed[0].map((column) => column.trim().toLowerCase());
  const columnMap = new Map<number, ContactFileField>();

  header.forEach((column, index) => {
    const mapped = HEADER_ALIASES[column];
    if (mapped) {
      columnMap.set(index, mapped);
    }
  });

  const mappedFields = new Set(columnMap.values());
  // A first row containing an address is data, not a header.
  let firstDataRow = parsed[0].some(looksLikeEmail) ? 0 : 1;

  if (!mappedFields.has("email")) {
    const detected = detectEmailColumn(parsed);
    if (detected < 0) {
      return {
        rows: [],
        error:
          "We couldn't find any email addresses in this file. Add one email per line, or a column containing email addresses.",
      };
    }

    columnMap.set(detected, "email");
    // Unlabeled columns stay empty rather than guessing which name is which.
    if (mappedFields.size === 0) {
      firstDataRow = looksLikeEmail(parsed[0][detected] ?? "") ? 0 : 1;
    }
  }

  const rows: ParsedContactsFile["rows"] = [];

  for (let i = firstDataRow; i < parsed.length; i++) {
    const record = emptyRow(i + 1);

    parsed[i].forEach((value, index) => {
      const field = columnMap.get(index);
      if (field) {
        assignField(record, field, value);
      }
    });

    rows.push(record);
  }

  return { rows };
}
