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

export default async function NewCampaignPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

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
          <CampaignForm emailAccounts={accounts} availableContacts={contacts ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
