import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { CampaignsList } from "@/features/campaigns/components/campaigns-list";
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
        <CampaignsList campaigns={campaigns} />
      </Card>
    </div>
  );
}
