import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { CampaignStatusBadge } from "@/features/campaigns/components/campaign-status-badge";
import { listCampaigns } from "@/features/campaigns/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Campaigns",
};

export default async function CampaignsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { campaigns, error } = await listCampaigns(user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Campaigns
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Create, preview, send, pause, and resume bulk email campaigns.
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" />
          New campaign
        </Link>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Subject</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-slate-500">
                    No campaigns yet. Create your first campaign to get started.
                  </td>
                </tr>
              ) : (
                campaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                  >
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
                      <CampaignStatusBadge status={campaign.status} />
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
      </Card>
    </div>
  );
}
