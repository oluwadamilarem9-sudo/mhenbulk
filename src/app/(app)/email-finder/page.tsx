import { z } from "zod";

import {
  getEmailFinderBatchDetail,
  listEmailFinderBatches,
} from "@/features/email-finder/batch-queries";
import { EmailFinderPanel } from "@/features/email-finder/components/email-finder-panel";
import { WebsiteBatchPanel } from "@/features/email-finder/components/website-batch-panel";
import {
  getEmailFinderScanDetail,
  listDraftCampaignOptions,
  listRecentEmailFinderScans,
} from "@/features/email-finder/queries";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Email Finder",
};

type PageProps = {
  searchParams: Promise<{
    scanId?: string | string[];
    batchId?: string | string[];
  }>;
};

function firstValue(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EmailFinderPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const query = await searchParams;
  const scanId = z.string().uuid().safeParse(firstValue(query.scanId));
  const batchId = z.string().uuid().safeParse(firstValue(query.batchId));

  const [recentScans, draftCampaigns, detail, batches, batchDetail] =
    await Promise.all([
      listRecentEmailFinderScans(user.id),
      listDraftCampaignOptions(user.id),
      scanId.success
        ? getEmailFinderScanDetail(user.id, scanId.data)
        : Promise.resolve(null),
      listEmailFinderBatches(user.id),
      batchId.success
        ? getEmailFinderBatchDetail(user.id, batchId.data)
        : Promise.resolve(null),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Email Finder
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Discover publicly listed emails, save them to Contacts, then continue into a campaign.
        </p>
      </div>

      <EmailFinderPanel
        initialScan={detail?.scan ?? null}
        initialResults={detail?.results ?? []}
        recentScans={recentScans}
        draftCampaigns={draftCampaigns}
      />

      <WebsiteBatchPanel
        batches={batches}
        detail={batchDetail}
        draftCampaigns={draftCampaigns}
      />
    </div>
  );
}
