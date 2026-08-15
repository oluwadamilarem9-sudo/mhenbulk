import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CampaignForm } from "@/features/campaigns/components/campaign-form";

export const metadata = {
  title: "New campaign",
};

export default function NewCampaignPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          New campaign
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Write your email, then preview and choose recipients on the next screen.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaign details</CardTitle>
          <CardDescription>
            Fill in the message you want to send. Subject is optional — if blank, the
            campaign name is used.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignForm />
        </CardContent>
      </Card>
    </div>
  );
}
