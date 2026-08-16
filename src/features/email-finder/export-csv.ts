import type { EmailFinderResultRow } from "@/features/email-finder/queries";

const HEADER = [
  "first_name",
  "last_name",
  "email",
  "company",
  "source_url",
  "discovered_at",
];

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Exports in the same shape the contacts importer accepts. */
export function exportResultsCsv(
  rows: EmailFinderResultRow[],
  fileName = "email-finder-results.csv",
) {
  const lines = [
    HEADER.join(","),
    ...rows.map((row) =>
      ["", "", row.email, "", row.sourceUrl, row.createdAt].map(String).map(quote).join(","),
    ),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}
