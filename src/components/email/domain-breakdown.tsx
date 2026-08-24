"use client";

import type { DomainBreakdown } from "@/lib/email-domain-stats";

type Props = {
  breakdown: DomainBreakdown;
  selectedDomain: string;
  onSelectDomain: (domain: string) => void;
  sort?: "count" | "alpha" | "percentage";
  onSortChange?: (sort: "count" | "alpha" | "percentage") => void;
};

export function DomainBreakdownPanel({
  breakdown,
  selectedDomain,
  onSelectDomain,
  sort = "count",
  onSortChange,
}: Props) {
  if (breakdown.total === 0) return null;

  const sorted = [...breakdown.entries];
  if (sort === "alpha") {
    sorted.sort((a, b) => a.domain.localeCompare(b.domain));
  } else if (sort === "percentage") {
    sorted.sort((a, b) => b.percentage - a.percentage || a.domain.localeCompare(b.domain));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">Domain breakdown</p>
          <p className="text-xs text-slate-500">{breakdown.total} emails</p>
        </div>
        {onSortChange ? (
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
            value={sort}
            onChange={(event) =>
              onSortChange(event.target.value as "count" | "alpha" | "percentage")
            }
          >
            <option value="count">Most emails</option>
            <option value="alpha">Alphabetical</option>
            <option value="percentage">Percentage</option>
          </select>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSelectDomain("all")}
          className={`rounded-full px-3 py-1 text-xs ${
            selectedDomain === "all"
              ? "bg-indigo-600 text-white"
              : "bg-white text-slate-700 ring-1 ring-slate-200"
          }`}
        >
          All domains
        </button>
        {sorted.map((entry) => (
          <button
            key={entry.domain}
            type="button"
            onClick={() => onSelectDomain(entry.domain)}
            className={`rounded-full px-3 py-1 text-xs ${
              selectedDomain === entry.domain
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200"
            }`}
          >
            {entry.domain} · {entry.count} ({entry.percentage.toFixed(1)}%)
          </button>
        ))}
      </div>
    </div>
  );
}
