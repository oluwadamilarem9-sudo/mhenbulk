import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

export type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];

export const MISSING_SCHEMA_MESSAGE =
  "The database tables have not been created yet. Run supabase/migrations/0001_initial_schema.sql in your Supabase SQL editor, then refresh this page.";

export function isMissingTableError(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    Boolean(error.message?.includes("Could not find the table"))
  );
}

export async function listContacts(userId: string): Promise<{
  contacts: ContactRow[];
  error?: string;
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    return {
      contacts: [],
      error: isMissingTableError(error)
        ? MISSING_SCHEMA_MESSAGE
        : "Unable to load contacts right now.",
    };
  }

  return { contacts: data ?? [] };
}
