import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CampaignDetail } from "@/features/campaigns/components/campaign-detail";
import { CampaignForm } from "@/features/campaigns/components/campaign-form";
import { getCampaign } from "@/features/campaigns/queries";
import { renderCampaignEmail } from "@/lib/email/render";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Campaign",
};

type CampaignPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CampaignPage({ params }: CampaignPageProps) {
  const { id } = await params;

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

  const { campaign, stats, failures, engagement } = await getCampaign(user.id, id);

  if (!campaign) {
    notFound();
  }

  const { data: eligibleContacts } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, email")
    .eq("user_id", user.id)
    .eq("is_unsubscribed", false)
    .eq("is_suppressed", false)
    .order("created_at", { ascending: false })
    .limit(1000);

  const preview = renderCampaignEmail({
    subject: campaign.subject,
    htmlContent: campaign.html_content,
    textContent: campaign.text_content,
    vars: {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
    },
    unsubscribeUrl: "#preview",
  });

  return (
    <div className="space-y-8">
      <div className="text-sm">
        <Link href="/campaigns" className="text-slate-500 hover:text-slate-700">
          ← Back to campaigns
        </Link>
      </div>

      <CampaignDetail
        campaign={campaign}
        stats={stats}
        eligibleContacts={eligibleContacts ?? []}
        previewHtml={preview.html}
        failures={failures}
        engagement={engagement}
      />

      {campaign.status === "draft" ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit campaign</CardTitle>
            <CardDescription>
              Update the name, subject, or content. Editing is locked once sending starts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CampaignForm campaign={campaign} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
