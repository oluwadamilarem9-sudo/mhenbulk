import { z } from "zod";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CampaignForm } from "@/features/campaigns/components/campaign-form";
import { listEmailAccounts } from "@/features/email-accounts/queries";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata = {
  title: "New campaign",
};

type PageProps = {
  searchParams: Promise<{
    finderScanId?: string | string[];
    finderBatchId?: string | string[];
  }>;
};

export default async function NewCampaignPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const query = await searchParams;
  const rawFinderScanId = Array.isArray(query.finderScanId)
    ? query.finderScanId[0]
    : query.finderScanId;
  const rawFinderBatchId = Array.isArray(query.finderBatchId)
    ? query.finderBatchId[0]
    : query.finderBatchId;
  const finderScanId = z.string().uuid().safeParse(rawFinderScanId);
  const finderBatchId = z.string().uuid().safeParse(rawFinderBatchId);

  const [{ accounts }, { data: contacts }] = await Promise.all([
    listEmailAccounts(user.id),
    supabase
      .from("contacts")
      .select("id, first_name, last_name, email")
      .eq("user_id", user.id)
      .eq("is_unsubscribed", false)
      .eq("is_suppressed", false)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  let preselectedContactIds: string[] = [];
  if (finderScanId.success || finderBatchId.success) {
    const selection = supabase
      .from("email_finder_results")
      .select("contact_id")
      .eq("user_id", user.id)
      .eq("selected", true)
      .not("contact_id", "is", null)
      .limit(2_000);

    if (finderScanId.success) selection.eq("scan_id", finderScanId.data);
    if (finderBatchId.success) selection.eq("batch_id", finderBatchId.data);

    const { data: selectedResults } = await selection;

    preselectedContactIds = [
      ...new Set(
        (selectedResults ?? [])
          .map((row) => row.contact_id)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
  }

  const availableContacts = contacts ?? [];
  // Ensure preselected finder contacts appear even if outside the latest-500 window.
  if (preselectedContactIds.length) {
    const present = new Set(availableContacts.map((contact) => contact.id));
    const missing = preselectedContactIds.filter((id) => !present.has(id));
    if (missing.length) {
      const { data: extra } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, email")
        .eq("user_id", user.id)
        .eq("is_unsubscribed", false)
        .eq("is_suppressed", false)
        .in("id", missing);
      availableContacts.unshift(...(extra ?? []));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          New campaign
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose your Gmail sending account, write your email, then preview and
          choose recipients on the next screen.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaign details</CardTitle>
          <CardDescription>
            Fill in the message you want to send. Subject is optional and the internal
            campaign name is never shown to recipients. Emails use your connected Gmail account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignForm
            emailAccounts={accounts}
            availableContacts={availableContacts}
            preselectedContactIds={preselectedContactIds}
            finderScanId={finderScanId.success ? finderScanId.data : null}
            finderBatchId={finderBatchId.success ? finderBatchId.data : null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
