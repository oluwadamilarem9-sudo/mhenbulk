import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listEmailAccounts } from "@/features/email-accounts/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, company_name, created_at")
    .eq("id", user.id)
    .maybeSingle();

  const { accounts } = await listEmailAccounts(user.id);
  const connected = accounts.filter(
    (account) =>
      account.status === "connected" || account.status === "rate_limited",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Workspace profile and connected sending accounts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Account details from your Supabase profile.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium text-slate-900">{profile?.full_name || "—"}</dd>
            </div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <dt className="text-slate-500">Email</dt>
              <dd className="font-medium text-slate-900">
                {profile?.email || user.email}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-500">Member since</dt>
              <dd className="font-medium text-slate-900">
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString()
                  : "—"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email accounts</CardTitle>
          <CardDescription>
            Campaigns send through your connected Gmail account. A Mhenbulk
            domain is not required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <div className="flex flex-wrap items-center gap-2">
            <span>Connected Gmail accounts:</span>
            {connected.length > 0 ? (
              <Badge variant="success">{connected.length}</Badge>
            ) : (
              <Badge variant="warning">None</Badge>
            )}
          </div>
          {connected.length > 0 ? (
            <ul className="space-y-1">
              {connected.map((account) => (
                <li key={account.id} className="font-medium text-slate-900">
                  {account.display_name
                    ? `${account.display_name} <${account.email}>`
                    : account.email}
                </li>
              ))}
            </ul>
          ) : (
            <p>Connect Gmail to send campaigns from your own address.</p>
          )}
          <Link
            href="/settings/email-accounts"
            className="inline-flex text-sm font-medium text-indigo-600 hover:underline"
          >
            Manage email accounts →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
