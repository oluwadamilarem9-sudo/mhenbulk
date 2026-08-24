import { redirect } from "next/navigation";
import { z } from "zod";

import { EmailCleanerPanel } from "@/features/email-cleaner/components/email-cleaner-panel";
import { getEmailCleanerPageData } from "@/features/email-cleaner/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Email Cleaner",
};

type PageProps = {
  searchParams: Promise<{ jobId?: string | string[] }>;
};

function firstValue(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EmailCleanerPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const query = await searchParams;
  const jobId = z.string().uuid().safeParse(firstValue(query.jobId));
  const data = await getEmailCleanerPageData(
    user.id,
    jobId.success ? jobId.data : undefined,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Email Cleaner
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Clean, normalize and organize your email lists before outreach.
        </p>
      </div>
      <EmailCleanerPanel
        jobs={data.jobs}
        activeJob={data.job}
        results={data.results}
        draftCampaigns={data.draftCampaigns}
      />
    </div>
  );
}

