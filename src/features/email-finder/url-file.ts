/**
 * Parses a list of websites out of a CSV, TSV, or TXT file.
 *
 * A header row is optional: any cell that looks like a URL or bare domain is
 * treated as a target, so exports such as `created,domain_url` work unchanged.
 * Nothing here performs network access — SSRF checks run again at scan time.
 */

import { parseDelimited, stripBom } from "@/features/contacts/csv";

export const MAX_BATCH_TARGETS = 5_000;

export type ParsedWebsiteRow = {
  url: string;
  domain: string;
  line: number;
};

export type ParsedWebsiteFile = {
  rows: ParsedWebsiteRow[];
  duplicates: number;
  skipped: number;
  truncated: boolean;
  error?: string;
};

const BARE_DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d{2,5})?(?:[/?#]\S*)?$/i;

/** Keeps filenames in a spreadsheet from being mistaken for bare domains. */
const FILE_SUFFIX =
  /\.(pdf|csv|tsv|txt|xlsx?|docx?|pptx?|zip|rar|png|jpe?g|gif|svg|webp|mp[34]|mov|json|xml|ya?ml)$/i;

/** Trailing punctuation is common when URLs are pasted from prose. */
function trimNoise(value: string): string {
  return value
    .trim()
    .replace(/^["'<(\[]+/, "")
    .replace(/["'>)\].,;:]+$/, "");
}

export function normalizeWebsiteCandidate(
  value: string,
): { url: string; domain: string; key: string } | null {
  const candidate = trimNoise(value);
  if (!candidate || /\s/.test(candidate) || candidate.includes("@")) return null;

  let withProtocol: string | null = null;
  if (/^https?:\/\//i.test(candidate)) {
    withProtocol = candidate;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    // Another scheme such as mailto: or ftp: — rejected by the protocol check.
    withProtocol = candidate;
  } else if (BARE_DOMAIN.test(candidate) && !FILE_SUFFIX.test(candidate)) {
    withProtocol = `https://${candidate}`;
  }

  if (!withProtocol) return null;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.includes(".") || !/[a-z]{2,}$/.test(hostname)) return null;

  parsed.hash = "";
  parsed.hostname = hostname;

  const path = parsed.pathname.replace(/\/+$/, "");
  const keyHost = hostname.replace(/^www\./, "");

  return {
    url: parsed.toString(),
    domain: hostname,
    key: `${keyHost}${path}${parsed.search}`,
  };
}

export function parseWebsiteUrlFile(
  text: string,
  fileName: string,
): ParsedWebsiteFile {
  const extension = fileName.toLowerCase().split(".").pop();
  const grid =
    extension === "txt"
      ? stripBom(text)
          .split(/\r?\n/)
          .map((line) => [line])
      : parseDelimited(text, extension === "tsv" ? "\t" : ",");

  if (grid.length === 0) {
    return {
      rows: [],
      duplicates: 0,
      skipped: 0,
      truncated: false,
      error: "The selected file is empty.",
    };
  }

  const rows: ParsedWebsiteRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let skipped = 0;
  let truncated = false;

  grid.forEach((cells, index) => {
    const candidate = cells
      .map((cell) => normalizeWebsiteCandidate(cell))
      .find((result) => result !== null);

    if (!candidate) {
      // A first row without a URL is a header, not a skipped target.
      if (index > 0 && cells.some((cell) => cell.trim() !== "")) skipped += 1;
      return;
    }

    if (seen.has(candidate.key)) {
      duplicates += 1;
      return;
    }

    if (rows.length >= MAX_BATCH_TARGETS) {
      truncated = true;
      return;
    }

    seen.add(candidate.key);
    rows.push({ url: candidate.url, domain: candidate.domain, line: index + 1 });
  });

  if (rows.length === 0) {
    return {
      rows: [],
      duplicates,
      skipped,
      truncated,
      error:
        "We couldn't find any website addresses in this file. Add one website per line, or a column of website URLs.",
    };
  }

  return { rows, duplicates, skipped, truncated };
}
