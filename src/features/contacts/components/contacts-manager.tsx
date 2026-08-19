"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import {
  addContactTagAction,
  deleteContactAction,
  deleteContactsAction,
  removeContactTagAction,
  setContactStatusAction,
} from "@/features/contacts/actions";
import type {
  ContactRow,
  ContactStatus,
  ContactTag,
} from "@/features/contacts/queries";
import { ContactForm } from "@/features/contacts/components/contact-form";
import { CsvImport } from "@/features/contacts/components/csv-import";
import { PasteContacts } from "@/features/contacts/components/paste-contacts";
import { createContactBatchesAction } from "@/features/smart-batching/actions";
import { contactDisplayName } from "@/features/contacts/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ContactsManagerProps = {
  contacts: ContactRow[];
  tags: ContactTag[];
  defaultBatchSize: number;
};

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; contact: ContactRow };

const statusPresentation: Record<
  ContactStatus,
  { label: string; variant: "success" | "warning" | "danger" | "muted" }
> = {
  active: { label: "Active", variant: "success" },
  unsubscribed: { label: "Unsubscribed", variant: "warning" },
  bounced: { label: "Bounced", variant: "danger" },
  invalid: { label: "Invalid", variant: "muted" },
};

export function ContactsManager({
  contacts,
  tags,
  defaultBatchSize,
}: ContactsManagerProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ContactStatus>("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((contact) => {
      const matchesSearch =
        !query ||
        `${contact.first_name} ${contact.last_name} ${contact.email} ${contact.company ?? ""} ${contact.phone ?? ""} ${contact.tags.map((tag) => tag.name).join(" ")}`
          .toLowerCase()
          .includes(query);
      const matchesStatus =
        statusFilter === "all" || contact.status === statusFilter;
      const matchesTag =
        tagFilter === "all" || contact.tags.some((tag) => tag.id === tagFilter);
      return matchesSearch && matchesStatus && matchesTag;
    });
  }, [contacts, search, statusFilter, tagFilter]);

  const allFilteredSelected =
    filtered.length > 0 &&
    filtered.every((contact) => selectedIds.has(contact.id));

  function toggleContact(contactId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        filtered.forEach((contact) => next.delete(contact.id));
      } else {
        filtered.forEach((contact) => next.add(contact.id));
      }
      return next;
    });
  }

  function handleBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    if (
      !window.confirm(
        `Delete ${ids.length} selected contact${ids.length === 1 ? "" : "s"}? This also removes them from campaign history and cannot be undone.`,
      )
    ) {
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const result = await deleteContactsAction(ids);
      if (result.error) {
        setMessage({ kind: "error", text: result.error });
        return;
      }

      setSelectedIds(new Set());
      setMessage({
        kind: "success",
        text: result.success ?? "Selected contacts deleted.",
      });
      router.refresh();
    });
  }

  function handleCreateBatches() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const entered = window.prompt(
      `Create Smart Batches for ${ids.length} selected contacts.\nBatch size:`,
      String(defaultBatchSize),
    );
    if (entered === null) return;
    const batchSize = Number(entered);
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
      setMessage({
        kind: "error",
        text: "Batch size must be a whole number from 1 to 1,000.",
      });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await createContactBatchesAction(ids, batchSize, "manual");
      setMessage(
        result.error
          ? { kind: "error", text: result.error }
          : { kind: "success", text: result.success ?? "Batches created." },
      );
      if (!result.error) {
        setSelectedIds(new Set());
        router.refresh();
      }
    });
  }

  function closeEditor() {
    setEditor({ mode: "closed" });
    router.refresh();
  }

  function handleDelete(contact: ContactRow) {
    if (
      !window.confirm(
        `Delete ${contact.first_name} ${contact.last_name}? This also removes their campaign history and cannot be undone.`,
      )
    ) {
      return;
    }

    setPendingId(contact.id);
    startTransition(async () => {
      const result = await deleteContactAction(contact.id);
      setPendingId(null);
      if (result.error) {
        setMessage({ kind: "error", text: result.error });
      } else {
        router.refresh();
      }
    });
  }

  function handleStatus(contact: ContactRow, status: ContactStatus) {
    setPendingId(contact.id);
    startTransition(async () => {
      const result = await setContactStatusAction(contact.id, status);
      setMessage(
        result.error
          ? { kind: "error", text: result.error }
          : { kind: "success", text: result.success ?? "Status updated." },
      );
      setPendingId(null);
      router.refresh();
    });
  }

  function handleAddTag(contactId: string) {
    const value = tagDraft.trim();
    if (!value) return;
    setPendingId(contactId);
    startTransition(async () => {
      const result = await addContactTagAction(contactId, value);
      setMessage(
        result.error
          ? { kind: "error", text: result.error }
          : { kind: "success", text: result.success ?? "Tag added." },
      );
      if (!result.error) setTagDraft("");
      setPendingId(null);
      router.refresh();
    });
  }

  function handleRemoveTag(contactId: string, tagId: string) {
    setPendingId(contactId);
    startTransition(async () => {
      const result = await removeContactTagAction(contactId, tagId);
      if (result.error) setMessage({ kind: "error", text: result.error });
      setPendingId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, company..."
              className="pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "all" | ContactStatus)
            }
            aria-label="Filter by status"
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="unsubscribed">Unsubscribed</option>
            <option value="bounced">Bounced</option>
            <option value="invalid">Invalid</option>
          </select>
          <select
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            aria-label="Filter by tag"
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
          >
            <option value="all">All tags</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CsvImport defaultBatchSize={defaultBatchSize} />
          <PasteContacts defaultBatchSize={defaultBatchSize} />
          <Button onClick={() => setEditor({ mode: "create" })}>
            <Plus className="h-4 w-4" />
            Add contact
          </Button>
        </div>
      </div>

      {selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <p className="text-sm font-medium text-indigo-900">
            {selectedIds.size} contact{selectedIds.size === 1 ? "" : "s"} selected
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={isPending}
              onClick={handleCreateBatches}
            >
              <Boxes className="h-4 w-4" />
              Create batches
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="border-rose-200 text-rose-700 hover:bg-rose-100"
              disabled={isPending}
              onClick={handleBulkDelete}
            >
              <Trash2 className="h-4 w-4" />
              {isPending ? "Deleting..." : "Delete selected"}
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <Alert variant={message.kind === "error" ? "error" : "success"}>
          {message.text}
        </Alert>
      ) : null}

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
                <th className="w-12 px-5 py-3 font-medium">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    disabled={filtered.length === 0 || isPending}
                    aria-label="Select all visible contacts"
                    className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                  />
                </th>
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
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                    {contacts.length === 0
                      ? "No contacts yet. Add one manually or import a file."
                      : "No contacts match the current search and filters."}
                  </td>
                </tr>
              ) : (
                filtered.map((contact) => {
                  const busy = pendingId === contact.id;
                  const presentation = statusPresentation[contact.status];
                  const expanded = expandedId === contact.id;

                  return (
                    <Fragment key={contact.id}>
                      <tr
                        className={`border-b border-slate-100 hover:bg-slate-50/60 ${
                          selectedIds.has(contact.id) ? "bg-indigo-50/70" : ""
                        }`}
                      >
                        <td className="px-5 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(contact.id)}
                            onChange={() => toggleContact(contact.id)}
                            disabled={isPending}
                            aria-label={`Select ${contact.email}`}
                            className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
                          />
                        </td>
                        <td className="px-5 py-3">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : contact.id)}
                            className="flex items-center gap-2 text-left font-medium text-slate-900 hover:text-indigo-700"
                          >
                            {expanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                            {contactDisplayName(contact.first_name, contact.last_name) ||
                              contact.email}
                          </button>
                          {contact.company ? (
                            <p className="ml-6 text-xs text-slate-500">{contact.company}</p>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-slate-600">{contact.email}</td>
                        <td className="px-5 py-3">
                          <Badge variant={presentation.variant}>{presentation.label}</Badge>
                        </td>
                        <td className="px-5 py-3 text-slate-500">
                          {new Date(contact.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <select
                              value={contact.status}
                              disabled={busy}
                              onChange={(event) =>
                                handleStatus(contact, event.target.value as ContactStatus)
                              }
                              aria-label={`Change status for ${contact.email}`}
                              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
                            >
                              <option value="active">Active</option>
                              <option value="unsubscribed">Unsubscribed</option>
                              <option value="bounced">Bounced</option>
                              <option value="invalid">Invalid</option>
                            </select>
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
                      {expanded ? (
                        <tr className="border-b border-slate-200 bg-slate-50/70">
                          <td colSpan={6} className="px-5 py-5">
                            <div className="grid gap-6 lg:grid-cols-2">
                              <div className="space-y-4">
                                <div className="grid gap-3 text-sm sm:grid-cols-2">
                                  <p className="flex items-center gap-2 text-slate-700">
                                    <Mail className="h-4 w-4 text-slate-400" />
                                    {contact.email}
                                  </p>
                                  <p className="flex items-center gap-2 text-slate-700">
                                    <Phone className="h-4 w-4 text-slate-400" />
                                    {contact.phone || "No phone"}
                                  </p>
                                  <p>
                                    <span className="text-slate-500">Company:</span>{" "}
                                    {contact.company || "—"}
                                  </p>
                                  <p>
                                    <span className="text-slate-500">Updated:</span>{" "}
                                    {new Date(contact.updated_at).toLocaleString()}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Notes
                                  </p>
                                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                                    {contact.notes || "No notes added."}
                                  </p>
                                </div>
                                <div>
                                  <div className="mb-2 flex flex-wrap gap-2">
                                    {contact.tags.map((tag) => (
                                      <Badge key={tag.id} variant="info">
                                        {tag.name}
                                        <button
                                          type="button"
                                          className="ml-1"
                                          disabled={busy}
                                          onClick={() => handleRemoveTag(contact.id, tag.id)}
                                          aria-label={`Remove ${tag.name}`}
                                        >
                                          ×
                                        </button>
                                      </Badge>
                                    ))}
                                  </div>
                                  <div className="flex max-w-sm gap-2">
                                    <div className="relative flex-1">
                                      <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                      <Input
                                        value={tagDraft}
                                        onChange={(event) => setTagDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") {
                                            event.preventDefault();
                                            handleAddTag(contact.id);
                                          }
                                        }}
                                        list="contact-tag-options"
                                        placeholder="Add a tag"
                                        className="pl-9"
                                      />
                                      <datalist id="contact-tag-options">
                                        {tags.map((tag) => (
                                          <option key={tag.id} value={tag.name} />
                                        ))}
                                      </datalist>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      disabled={busy || !tagDraft.trim()}
                                      onClick={() => handleAddTag(contact.id)}
                                    >
                                      Add
                                    </Button>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Campaign history
                                </p>
                                {contact.campaignHistory.length === 0 ? (
                                  <p className="mt-2 text-sm text-slate-500">
                                    This contact has not been added to a campaign.
                                  </p>
                                ) : (
                                  <div className="mt-2 space-y-2">
                                    {contact.campaignHistory.map((item) => (
                                      <div
                                        key={item.id}
                                        className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="font-medium text-slate-900">
                                            {item.campaignName}
                                          </p>
                                          <Badge variant="muted">{item.recipientStatus}</Badge>
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">
                                          {item.stepName ? `${item.stepName} · ` : ""}
                                          {new Date(item.sentAt || item.createdAt).toLocaleString()}
                                        </p>
                                        {item.lastError ? (
                                          <p className="mt-1 text-xs text-rose-600">
                                            {item.lastError}
                                          </p>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-slate-500">
        {contacts.length} contact{contacts.length === 1 ? "" : "s"} total. Import CSV,
        TSV, or TXT files. A header row is optional — email addresses are detected
        automatically, and name, company, phone, tags, and notes are optional.
      </p>
    </div>
  );
}
