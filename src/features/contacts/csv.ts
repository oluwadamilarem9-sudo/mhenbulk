/**
 * Delimited-file parser supporting quoted fields, escaped quotes, and CRLF.
 * Handles CSV and TSV without adding a dependency.
 */

export function parseDelimited(text: string, delimiter = ","): string[][] {
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

const HEADER_ALIASES: Record<string, "first_name" | "last_name" | "email"> = {
  first_name: "first_name",
  firstname: "first_name",
  "first name": "first_name",
  last_name: "last_name",
  lastname: "last_name",
  "last name": "last_name",
  email: "email",
  "email address": "email",
  email_address: "email",
};

export type ParsedContactsFile = {
  rows: Array<{ first_name: string; last_name: string; email: string; line: number }>;
  error?: string;
};

function parsePlainEmailList(text: string): ParsedContactsFile {
  const rows = text
    .split(/\r?\n/)
    .map((value, index) => ({
      first_name: "",
      last_name: "",
      email: value.trim(),
      line: index + 1,
    }))
    .filter((row) => row.email !== "" && row.email.toLowerCase() !== "email");

  return rows.length > 0
    ? { rows }
    : { rows: [], error: "The selected file is empty." };
}

/**
 * Accepted formats:
 * - .txt: one email per line (no header required)
 * - .csv/.tsv: an email column, with optional first_name and last_name columns
 * - headerless single-column CSV/TSV: one email per row
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
  const columnMap = new Map<number, "first_name" | "last_name" | "email">();

  header.forEach((column, index) => {
    const mapped = HEADER_ALIASES[column];
    if (mapped) {
      columnMap.set(index, mapped);
    }
  });

  const mappedFields = new Set(columnMap.values());

  if (!mappedFields.has("email")) {
    // A headerless single-column file is treated as one email per row.
    if (parsed.every((row) => row.length === 1)) {
      return {
        rows: parsed.map((row, index) => ({
          first_name: "",
          last_name: "",
          email: row[0].trim(),
          line: index + 1,
        })),
      };
    }

    return {
      rows: [],
      error:
        "The file must include an 'email' column. The first_name and last_name columns are optional.",
    };
  }

  const rows: ParsedContactsFile["rows"] = [];

  for (let i = 1; i < parsed.length; i++) {
    const record = { first_name: "", last_name: "", email: "", line: i + 1 };

    parsed[i].forEach((value, index) => {
      const field = columnMap.get(index);
      if (field) {
        record[field] = value.trim();
      }
    });

    rows.push(record);
  }

  return { rows };
}
