import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

  const provider = process.env.EMAIL_PROVIDER === "resend" && process.env.RESEND_API_KEY
    ? "resend"
    : "console";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Workspace profile and email provider configuration.
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
          <CardTitle>Email delivery</CardTitle>
          <CardDescription>
            The provider adapter is swappable via server environment variables — no code
            changes needed to move vendors.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <span>Active provider:</span>
            {provider === "resend" ? (
              <Badge variant="success">Resend</Badge>
            ) : (
              <Badge variant="warning">Console (development)</Badge>
            )}
          </div>
          {provider === "console" ? (
            <p>
              The console provider logs emails to the server terminal instead of
              delivering them. Set <code>EMAIL_PROVIDER=resend</code>,{" "}
              <code>RESEND_API_KEY</code>, and <code>EMAIL_FROM</code> in{" "}
              <code>.env.local</code> to send real email.
            </p>
          ) : (
            <p>
              Sending from <code>{process.env.EMAIL_FROM || "onboarding@resend.dev"}</code>.
            </p>
          )}
          <p>
            Secrets stay server-side. All API inputs are validated with Zod, and Row
            Level Security scopes every table to its owner.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
