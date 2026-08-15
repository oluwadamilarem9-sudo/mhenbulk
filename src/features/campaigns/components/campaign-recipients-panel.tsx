"use client";

import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import { Search, Upload, UserPlus, UserRoundCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addAndEnrollContactAction,
  enrollCampaignContactsAction,
  importAndEnrollCampaignContactsAction,
  markCampaignRecipientRepliedAction,
  removeCampaignContactAction,
} from "@/features/campaigns/actions";
import {
  parseContactsFile,
  type ParsedContactRow,
} from "@/features/contacts/csv";
import type {
  CampaignMember,
  EligibleCampaignContact,
} from "@/features/campaigns/queries";
import type { CampaignActionState } from "@/features/campaigns/schemas";

type Props = {
  campaignId: string;
  isDraft: boolean;
  members: CampaignMember[];
  eligibleContacts: EligibleCampaignContact[];
};

const initialState: CampaignActionState = {};

export function CampaignRecipientsPanel({
  campaignId,
  isDraft,
  members,
  eligibleContacts,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<CampaignActionState | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ParsedContactRow[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [addState, addAction, addPending] = useActionState(
    addAndEnrollContactAction,
    initialState,
  );
  const available = useMemo(
    () =>
      eligibleContacts.filter((contact) => {
        if (contact.enrolled) return false;
        const value = `${contact.first_name} ${contact.last_name} ${contact.email}`.toLowerCase();
        return value.includes(search.toLowerCase());
      }),
    [eligibleContacts, search],
  );
  const filteredMembers = useMemo(() => {
    const query = search.toLowerCase();
    return members.filter((member) =>
      `${member.firstName} ${member.lastName} ${member.email}`.toLowerCase().includes(query),
    );
  }, [members, search]);

  function run(action: () => Promise<CampaignActionState>) {
    startTransition(async () => {
      const result = await action();
      setMessage(result);
      router.refresh();
    });
  }

  async function previewImport(file: File | null) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setImportFile(file);
      setImportPreview([]);
      setImportError("Contact files are limited to 2 MB.");
      return;
    }
    const parsed = parseContactsFile(await file.text(), file.name);
    setImportFile(file);
    setImportPreview(parsed.rows);
    setImportError(parsed.error ?? null);
  }

  function confirmImport() {
    if (!importFile) return;
    const data = new FormData();
    data.set("campaignId", campaignId);
    data.set("file", importFile);
    run(() => importAndEnrollCampaignContactsAction(data));
    setImportFile(null);
    setImportPreview([]);
    setImportError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      {(message?.error || message?.success) ? (
        <Alert variant={message.error ? "error" : "success"}>
          {message.error ?? message.success}
        </Alert>
      ) : null}
      {addState.error ? <Alert variant="error">{addState.error}</Alert> : null}
      {addState.success ? <Alert variant="success">{addState.success}</Alert> : null}

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search recipients by name or email"
          className="pl-9"
        />
      </div>

      {isDraft ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-xl border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">Add existing contacts</h3>
                <p className="text-xs text-slate-500">
                  Only subscribed, non-suppressed contacts are shown.
                </p>
              </div>
              <Button
                size="sm"
                disabled={busy || selected.size === 0}
                onClick={() =>
                  run(() => enrollCampaignContactsAction(campaignId, [...selected]))
                }
              >
                <UserPlus className="h-4 w-4" />
                Add {selected.size || ""}
              </Button>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {available.length ? available.map((contact) => (
                <label
                  key={contact.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(contact.id)}
                    onChange={() => setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(contact.id)) next.delete(contact.id);
                      else next.add(contact.id);
                      return next;
                    })}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-slate-900">
                      {contact.first_name} {contact.last_name}
                    </span>
                    <span className="block truncate text-slate-500">{contact.email}</span>
                  </span>
                </label>
              )) : (
                <p className="py-6 text-center text-sm text-slate-500">
                  No matching contacts available.
                </p>
              )}
            </div>
          </section>

          <section className="space-y-5 rounded-xl border border-slate-200 p-4">
            <div>
              <h3 className="font-semibold text-slate-900">Add a new contact</h3>
              <p className="text-xs text-slate-500">
                Saves to global contacts and enrolls in this campaign.
              </p>
            </div>
            <form action={addAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="campaignId" value={campaignId} />
              <div>
                <Label htmlFor="campaign-first-name">First name</Label>
                <Input id="campaign-first-name" name="firstName" required />
              </div>
              <div>
                <Label htmlFor="campaign-last-name">Last name</Label>
                <Input id="campaign-last-name" name="lastName" required />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="campaign-email">Email</Label>
                <Input id="campaign-email" name="email" type="email" required />
              </div>
              <Button type="submit" disabled={addPending} className="sm:col-span-2">
                {addPending ? "Adding..." : "Save and enroll"}
              </Button>
            </form>
            <div className="border-t border-slate-100 pt-4">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
                onChange={(event) =>
                  void previewImport(event.target.files?.[0] ?? null)
                }
              />
              <Button
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Import and enroll file
              </Button>
              {importFile ? (
                <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-900">
                    Preview {importFile.name}
                  </p>
                  {importError ? (
                    <Alert variant="error">{importError}</Alert>
                  ) : (
                    <>
                      <p className="text-xs text-slate-500">
                        {importPreview.length} row(s) found. The server will skip
                        invalid, duplicate, unsubscribed, and suppressed addresses.
                      </p>
                      <ul className="max-h-28 space-y-1 overflow-y-auto text-xs text-slate-600">
                        {importPreview.slice(0, 5).map((row) => (
                          <li key={`${row.line}-${row.email}`}>
                            {row.first_name} {row.last_name}{" "}
                            <span className="text-slate-500">
                              {row.email || "(missing email)"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={
                        busy || Boolean(importError) || importPreview.length === 0
                      }
                      onClick={confirmImport}
                    >
                      Confirm import
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setImportFile(null);
                        setImportPreview([]);
                        setImportError(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h3 className="font-semibold text-slate-900">Enrolled recipients</h3>
          <Badge variant="info">{members.length}</Badge>
        </div>
        <div className="divide-y divide-slate-100">
          {filteredMembers.length ? filteredMembers.map((member) => (
            <div key={member.membershipId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">
                  {member.firstName} {member.lastName}
                </p>
                <p className="truncate text-sm text-slate-500">{member.email}</p>
              </div>
              {member.repliedAt ? (
                <Badge variant="success">Replied</Badge>
              ) : (
                <Badge variant={member.deliveryStatus === "sent" ? "success" : "muted"}>
                  {member.deliveryStatus ?? "Enrolled"}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(() => removeCampaignContactAction(campaignId, member.contactId))
                }
              >
                <X className="h-4 w-4" />
                Remove
              </Button>
              {!isDraft && member.deliveryStatus === "sent" && !member.repliedAt && member.recipientId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(() => markCampaignRecipientRepliedAction(member.recipientId!))
                  }
                >
                  <UserRoundCheck className="h-4 w-4" />
                  Mark replied
                </Button>
              ) : null}
            </div>
          )) : (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              {members.length ? "No recipients match your search." : "No recipients enrolled yet."}
            </p>
          )}
        </div>
      </section>
      <p className="text-xs text-slate-500">
        Reply detection depends on the email provider. Until a provider reports a reply,
        use “Mark replied” to stop future automated steps for that contact.
      </p>
    </div>
  );
}
