"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EmailFinderResultRow } from "@/features/email-finder/queries";

type Props = {
  rows: EmailFinderResultRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** Shown instead of the page path when results span many websites. */
  showDomain?: boolean;
};

function sourceLabel(url: string, showDomain: boolean): string {
  try {
    const parsed = new URL(url);
    if (showDomain) return parsed.hostname.replace(/^www\./, "");
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}

export function FinderResultsTable({
  rows,
  selected,
  onToggle,
  showDomain = false,
}: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyEmail(row: EmailFinderResultRow) {
    await navigator.clipboard.writeText(row.email);
    setCopiedId(row.id);
    window.setTimeout(
      () => setCopiedId((current) => (current === row.id ? null : current)),
      1500,
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Select</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">
              {showDomain ? "Website" : "Source"}
            </th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => onToggle(row.id)}
                  aria-label={`Select ${row.email}`}
                />
              </td>
              <td className="px-4 py-3">
                <div className="font-medium break-all text-slate-900">{row.email}</div>
                {row.addedToContacts ? (
                  <p className="text-xs text-emerald-600">Already in Contacts</p>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant={
                    row.category === "generic"
                      ? "warning"
                      : row.category === "personal"
                        ? "info"
                        : "muted"
                  }
                >
                  {row.category}
                </Badge>
              </td>
              <td className="px-4 py-3 break-all text-slate-500">
                {sourceLabel(row.sourceUrl, showDomain)}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void copyEmail(row)}
                  >
                    {copiedId === row.id ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    Copy
                  </Button>
                  <a
                    href={row.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
