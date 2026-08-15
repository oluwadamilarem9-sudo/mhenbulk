import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import {
  CAMPAIGN_TABS,
  CampaignWorkspace,
  type CampaignTab,
} from "@/features/campaigns/components/campaign-workspace";
import { getCampaignWorkspace } from "@/features/campaigns/queries";
import { subjectForSend } from "@/features/campaigns/schemas";
import { listEmailAccounts } from "@/features/email-accounts/queries";
import { renderCampaignEmail } from "@/lib/email/render";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Campaign",
};

type CampaignPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

export default async function CampaignPage({ params, searchParams }: CampaignPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const activeTab: CampaignTab = CAMPAIGN_TABS.includes(requestedTab as CampaignTab)
    ? requestedTab as CampaignTab
    : "overview";

  if (!z.string().uuid().safeParse(id).success) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [workspace, accountResult] = await Promise.all([
    getCampaignWorkspace(user.id, id),
    listEmailAccounts(user.id),
  ]);

  if (!workspace) {
    notFound();
  }

  const { campaign } = workspace;
  const { accounts } = accountResult;

  const preview = renderCampaignEmail({
    subject: subjectForSend(campaign.subject),
    htmlContent: campaign.html_content,
    textContent: campaign.text_content,
    vars: {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
    },
  });

  const senderLabel = campaign.from_email
    ? campaign.from_name
      ? `${campaign.from_name} <${campaign.from_email}>`
      : campaign.from_email
    : null;

  return (
    <div className="space-y-8">
      <div className="text-sm">
        <Link href="/campaigns" className="text-slate-500 hover:text-slate-700">
          ← Back to campaigns
        </Link>
      </div>

      <CampaignWorkspace
        data={workspace}
        activeTab={activeTab}
        accounts={accounts}
        previewHtml={preview.html}
        senderLabel={senderLabel}
      />
    </div>
  );
}
