import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

import { Alert } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatsCards } from "@/features/dashboard/components/stats-cards";
import { getDashboardMetrics } from "@/features/dashboard/queries";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { metrics, error } = await getDashboardMetrics(user.id);
  const isEmpty =
    metrics.totalContacts === 0 &&
    metrics.totalCampaigns === 0 &&
    metrics.emailsSent === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Overview of contacts, campaigns, and delivery outcomes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/contacts"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-slate-900 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50"
          >
            Manage contacts
          </Link>
          <Link
            href="/contacts#smart-batches"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-slate-900 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50"
          >
            Smart Batches
          </Link>
          <Link
            href="/campaigns"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500"
          >
            View campaigns
          </Link>
        </div>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <StatsCards metrics={metrics} />

      {isEmpty && !error ? (
        <Card>
          <CardHeader>
            <CardTitle>Welcome to Mhenbulk</CardTitle>
            <CardDescription>
              Your workspace is ready. Get started in two steps.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Add contacts manually, paste emails, or import a CSV on the Contacts
                page — imports create Smart Batches automatically.
              </li>
              <li>
                Create a campaign, attach batches, preview with {"{{first_name}}"}{" "}
                personalization, send yourself a test, then queue a batch.
              </li>
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
