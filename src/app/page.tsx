import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { hasPublicSupabaseConfig } from "@/lib/env";

export default async function HomePage() {
  if (!hasPublicSupabaseConfig()) {
    redirect("/login");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
