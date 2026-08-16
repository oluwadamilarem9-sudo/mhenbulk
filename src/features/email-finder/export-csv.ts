import type { EmailFinderResultRow } from "@/features/email-finder/queries";

const HEADER = [
  "email",
  "domain",
  "source_url",
  "category",
  "confidence",
  "discovered_at",
  "first_name",
  "last_name",
];

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Exports finder results with auditable source and classification fields. */
export function exportResultsCsv(
  rows: EmailFinderResultRow[],
  fileName = "email-finder-results.csv",
) {
  const lines = [
    HEADER.join(","),
    ...rows.map((row) =>
      [
        row.email,
        row.domain,
        row.sourceUrl,
        row.category,
        row.confidence,
        row.createdAt,
        "",
        "",
      ]
        .map(String)
        .map(quote)
        .join(","),
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
