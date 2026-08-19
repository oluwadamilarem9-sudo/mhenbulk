"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { CampaignStatusBadge } from "@/features/campaigns/components/campaign-status-badge";
import { deleteCampaignsAction } from "@/features/campaigns/actions";
import type { CampaignRow } from "@/features/campaigns/queries";

export function CampaignsList({ campaigns }: { campaigns: CampaignRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const allChecked = campaigns.length > 0 && selected.size === campaigns.length;
  const someChecked = selected.size > 0 && selected.size < campaigns.length;

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(campaigns.map((c) => c.id)));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDelete() {
    if (selected.size === 0) return;
    const confirmMsg =
      selected.size === 1
        ? "Delete this campaign? This cannot be undone."
        : `Delete ${selected.size} campaigns? This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCampaignsAction([...selected]);
      if (result.error) {
        setError(result.error);
      } else {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-2.5">
          <span className="text-sm font-medium text-red-700">
            {selected.size} campaign{selected.size === 1 ? "" : "s"} selected
          </span>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {isPending ? "Deleting…" : "Delete selected"}
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
              </th>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Subject</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-500">
                  No campaigns yet. Create your first campaign to get started.
                </td>
              </tr>
            ) : (
              campaigns.map((campaign) => (
                <tr
                  key={campaign.id}
                  className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/60 ${selected.has(campaign.id) ? "bg-red-50/40" : ""}`}
                >
                  <td className="px-5 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(campaign.id)}
                      onChange={() => toggle(campaign.id)}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/campaigns/${campaign.id}`}
                      className="font-medium text-indigo-600 hover:text-indigo-500"
                    >
                      {campaign.name}
                    </Link>
                  </td>
                  <td className="max-w-[280px] truncate px-5 py-3 text-slate-600">
                    {campaign.subject}
                  </td>
                  <td className="px-5 py-3">
                    <CampaignStatusBadge status={campaign.status as "draft" | "scheduled" | "sending" | "paused" | "completed" | "cancelled"} />
                  </td>
                  <td className="px-5 py-3 text-slate-500">
                    {new Date(campaign.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
