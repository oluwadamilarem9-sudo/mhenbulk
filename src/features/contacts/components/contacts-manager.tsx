"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";

import {
  deleteContactAction,
  setContactUnsubscribedAction,
} from "@/features/contacts/actions";
import type { ContactRow } from "@/features/contacts/queries";
import { ContactForm } from "@/features/contacts/components/contact-form";
import { CsvImport } from "@/features/contacts/components/csv-import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ContactsManagerProps = {
  contacts: ContactRow[];
};

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; contact: ContactRow };

export function ContactsManager({ contacts }: ContactsManagerProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return contacts;

    return contacts.filter((contact) =>
      `${contact.first_name} ${contact.last_name} ${contact.email}`
        .toLowerCase()
        .includes(query),
    );
  }, [contacts, search]);

  function closeEditor() {
    setEditor({ mode: "closed" });
    router.refresh();
  }

  function handleDelete(contact: ContactRow) {
    if (!window.confirm(`Delete ${contact.first_name} ${contact.last_name}?`)) {
      return;
    }

    setPendingId(contact.id);
    startTransition(async () => {
      await deleteContactAction(contact.id);
      setPendingId(null);
      router.refresh();
    });
  }

  function handleToggleUnsubscribed(contact: ContactRow) {
    setPendingId(contact.id);
    startTransition(async () => {
      await setContactUnsubscribedAction(contact.id, !contact.is_unsubscribed);
      setPendingId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search contacts..."
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CsvImport />
          <Button onClick={() => setEditor({ mode: "create" })}>
            <Plus className="h-4 w-4" />
            Add contact
          </Button>
        </div>
      </div>

      {editor.mode !== "closed" ? (
        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                {editor.mode === "create" ? "Add contact" : "Edit contact"}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditor({ mode: "closed" })}
                aria-label="Close form"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ContactForm
              contact={editor.mode === "edit" ? editor.contact : undefined}
              onDone={closeEditor}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Added</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-slate-500">
                    {contacts.length === 0
                      ? "No contacts yet. Add one manually or import a file."
                      : "No contacts match your search."}
                  </td>
                </tr>
              ) : (
                filtered.map((contact) => {
                  const busy = pendingId === contact.id;
                  const suppressed = contact.is_unsubscribed || contact.is_suppressed;

                  return (
                    <tr
                      key={contact.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                    >
                      <td className="px-5 py-3 font-medium text-slate-900">
                        {contact.first_name} {contact.last_name}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{contact.email}</td>
                      <td className="px-5 py-3">
                        {suppressed ? (
                          <Badge variant="danger">
                            {contact.is_unsubscribed ? "Unsubscribed" : "Suppressed"}
                          </Badge>
                        ) : (
                          <Badge variant="success">Subscribed</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {new Date(contact.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => handleToggleUnsubscribed(contact)}
                          >
                            {contact.is_unsubscribed ? "Resubscribe" : "Unsubscribe"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label="Edit contact"
                            onClick={() => setEditor({ mode: "edit", contact })}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label="Delete contact"
                            className="text-rose-600 hover:bg-rose-50"
                            onClick={() => handleDelete(contact)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-slate-500">
        {contacts.length} contact{contacts.length === 1 ? "" : "s"} total. Import CSV
        or TSV with an email column (first_name and last_name are optional), or a TXT
        file with one email per line.
      </p>
    </div>
  );
}
