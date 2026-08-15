import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { ContactsManager } from "@/features/contacts/components/contacts-manager";
import { listContacts } from "@/features/contacts/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Contacts",
};

export default async function ContactsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { contacts, tags, error } = await listContacts(user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Contacts
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage audience members, imports, and suppression status.
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <ContactsManager contacts={contacts} tags={tags} />
    </div>
  );
}
