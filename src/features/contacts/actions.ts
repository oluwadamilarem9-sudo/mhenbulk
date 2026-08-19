"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseContactsFile } from "@/features/contacts/csv";
import {
  MISSING_SCHEMA_MESSAGE,
  isMissingTableError,
} from "@/features/contacts/queries";
import {
  contactSchema,
  type ContactStatus,
  type ContactActionState,
  type CsvImportResult,
} from "@/features/contacts/schemas";
import { createClient } from "@/lib/supabase/server";
import { parsePastedEmails } from "@/features/smart-batching/batching";

const MAX_IMPORT_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;
const SUPPORTED_IMPORT_EXTENSIONS = new Set(["csv", "txt", "tsv"]);

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null as null };
  }

  return { supabase, user };
}

function isDuplicateError(message: string): boolean {
  return message.includes("contacts_user_email_unique") || message.includes("duplicate key");
}

function looseFrom(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
) {
  return supabase.from(table as "contacts");
}

function contactInput(formData: FormData) {
  return contactSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    company: formData.get("company"),
    phone: formData.get("phone"),
    notes: formData.get("notes"),
    status: formData.get("status") || "active",
  });
}

function statusFlags(status: ContactStatus) {
  return {
    status,
    is_unsubscribed: status === "unsubscribed",
    is_suppressed: status !== "active",
  };
}

async function addSuppression(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  contactId: string,
  email: string,
  status: Exclude<ContactStatus, "active">,
) {
  const details = {
    unsubscribed: { reason: "Manually unsubscribed", source: "manual" },
    bounced: { reason: "Manually marked as bounced", source: "manual" },
    invalid: { reason: "Manually marked as invalid", source: "manual" },
  }[status];

  return supabase.from("suppression_list").upsert(
    {
      user_id: userId,
      email,
      reason: details.reason,
      source: details.source,
      contact_id: contactId,
    },
    { onConflict: "user_id,email_normalized", ignoreDuplicates: true },
  );
}

async function syncSuppressionForStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  contactId: string,
  status: ContactStatus,
): Promise<ContactActionState> {
  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .select("id, email, email_normalized")
    .eq("id", contactId)
    .eq("user_id", userId)
    .maybeSingle();

  if (contactError || !contact) return { error: "Contact not found." };

  if (status !== "active") {
    const { error } = await addSuppression(
      supabase,
      userId,
      contact.id,
      contact.email,
      status,
    );
    return error ? { error: "Unable to update suppression status." } : {};
  }

  // Resubscribe only removes the suppression created by this manual action.
  // Bounce, complaint, and invalid-address records remain authoritative.
  await supabase
    .from("suppression_list")
    .delete()
    .eq("user_id", userId)
    .eq("email_normalized", contact.email_normalized)
    .eq("source", "manual");

  const { data: remaining } = await supabase
    .from("suppression_list")
    .select("source, reason")
    .eq("user_id", userId)
    .eq("email_normalized", contact.email_normalized);

  if (remaining && remaining.length > 0) {
    const protectedStatus: ContactStatus = remaining.some((entry) =>
      `${entry.source} ${entry.reason}`.toLowerCase().includes("bounce"),
    )
      ? "bounced"
      : "invalid";
    await supabase
      .from("contacts")
      .update(statusFlags(protectedStatus) as never)
      .eq("id", contact.id)
      .eq("user_id", userId);
    return {
      error:
        "This contact still has a bounce, complaint, or invalid-address suppression and cannot be reactivated.",
    };
  }

  await supabase
    .from("contacts")
    .update(statusFlags("active") as never)
    .eq("id", contact.id)
    .eq("user_id", userId);
  return {};
}

export async function createContactAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const parsed = contactInput(formData);

  if (!parsed.success) {
    return {
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { error } = await supabase.from("contacts").insert({
    user_id: user.id,
    first_name: parsed.data.firstName,
    last_name: parsed.data.lastName,
    email: parsed.data.email,
    company: parsed.data.company,
    phone: parsed.data.phone,
    notes: parsed.data.notes,
    ...statusFlags(parsed.data.status),
  } as never);

  if (error) {
    if (isDuplicateError(error.message)) {
      return { error: "A contact with this email already exists." };
    }
    if (isMissingTableError(error)) {
      return { error: MISSING_SCHEMA_MESSAGE };
    }
    return { error: "Unable to create the contact. Please try again." };
  }

  if (parsed.data.status !== "active") {
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, email")
      .eq("user_id", user.id)
      .eq("email_normalized", parsed.data.email.toLowerCase())
      .maybeSingle();
    if (contact) {
      const { error: suppressionError } = await addSuppression(
        supabase,
        user.id,
        contact.id,
        contact.email,
        parsed.data.status,
      );
      if (suppressionError) {
        return {
          error:
            "The contact was created as ineligible, but its suppression entry could not be saved. Please retry the status update.",
        };
      }
    }
  }

  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return { success: "Contact created." };
}

export async function updateContactAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const idResult = z.string().uuid().safeParse(formData.get("contactId"));
  const parsed = contactInput(formData);

  if (!idResult.success) {
    return { error: "Invalid contact reference." };
  }

  if (!parsed.success) {
    return {
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { error } = await supabase
    .from("contacts")
    .update({
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      email: parsed.data.email,
      company: parsed.data.company,
      phone: parsed.data.phone,
      notes: parsed.data.notes,
      ...statusFlags(parsed.data.status),
    } as never)
    .eq("id", idResult.data)
    .eq("user_id", user.id);

  if (error) {
    if (isDuplicateError(error.message)) {
      return { error: "Another contact already uses this email." };
    }
    return { error: "Unable to update the contact. Please try again." };
  }

  const statusResult = await syncSuppressionForStatus(
    supabase,
    user.id,
    idResult.data,
    parsed.data.status,
  );
  if (statusResult.error) return statusResult;

  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return { success: "Contact updated." };
}

export async function deleteContactAction(contactId: string): Promise<ContactActionState> {
  const idResult = z.string().uuid().safeParse(contactId);
  if (!idResult.success) {
    return { error: "Invalid contact reference." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", idResult.data)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Unable to delete the contact. Please try again." };
  }

  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return { success: "Contact deleted." };
}

export async function deleteContactsAction(
  contactIds: string[],
): Promise<ContactActionState> {
  const idsResult = z
    .array(z.string().uuid())
    .min(1)
    .max(1000)
    .safeParse(contactIds);

  if (!idsResult.success) {
    return { error: "Select between 1 and 1,000 valid contacts." };
  }

  const uniqueIds = [...new Set(idsResult.data)];
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { data: deleted, error } = await supabase
    .from("contacts")
    .delete()
    .eq("user_id", user.id)
    .in("id", uniqueIds)
    .select("id");

  if (error) {
    return { error: "Unable to delete the selected contacts. Please try again." };
  }

  const deletedCount = deleted?.length ?? 0;
  if (deletedCount === 0) {
    return { error: "No selected contacts were deleted." };
  }

  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return {
    success: `${deletedCount} contact${deletedCount === 1 ? "" : "s"} deleted.`,
  };
}

export async function setContactStatusAction(
  contactId: string,
  nextStatus: ContactStatus,
): Promise<ContactActionState> {
  const idResult = z.string().uuid().safeParse(contactId);
  const statusResult = z
    .enum(["active", "unsubscribed", "bounced", "invalid"])
    .safeParse(nextStatus);
  if (!idResult.success) {
    return { error: "Invalid contact reference." };
  }
  if (!statusResult.success) return { error: "Invalid contact status." };

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { error } = await supabase
    .from("contacts")
    .update(statusFlags(statusResult.data) as never)
    .eq("id", idResult.data)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Unable to update the contact status." };
  }

  const syncResult = await syncSuppressionForStatus(
    supabase,
    user.id,
    idResult.data,
    statusResult.data,
  );
  if (syncResult.error) return syncResult;

  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return {
    success:
      statusResult.data === "active"
        ? "Contact reactivated."
        : `Contact marked ${statusResult.data}.`,
  };
}

export async function setContactUnsubscribedAction(
  contactId: string,
  unsubscribed: boolean,
): Promise<ContactActionState> {
  return setContactStatusAction(contactId, unsubscribed ? "unsubscribed" : "active");
}

export async function addContactTagAction(
  contactId: string,
  tagName: string,
): Promise<ContactActionState> {
  const ids = z.string().uuid().safeParse(contactId);
  const name = z.string().trim().min(1).max(50).safeParse(tagName);
  if (!ids.success || !name.success) return { error: "Enter a valid tag name." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", ids.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!contact) return { error: "Contact not found." };

  const tagsTable = looseFrom(supabase, "tags");
  const { data: existing } = await tagsTable
    .select("*")
    .eq("user_id", user.id)
    .eq("name_normalized" as never, name.data.toLowerCase() as never)
    .maybeSingle();

  let tagId = (existing as unknown as { id?: string } | null)?.id;
  if (!tagId) {
    const { data: created, error } = await looseFrom(supabase, "tags")
      .insert({ user_id: user.id, name: name.data } as never)
      .select("*")
      .single();
    if (error) return { error: "Unable to create that tag." };
    tagId = (created as unknown as { id?: string }).id;
  }
  if (!tagId) return { error: "Unable to find that tag." };

  const { error } = await looseFrom(supabase, "contact_tags").upsert(
    { user_id: user.id, contact_id: contact.id, tag_id: tagId } as never,
    { onConflict: "contact_id,tag_id", ignoreDuplicates: true },
  );
  if (error) return { error: "Unable to add that tag." };

  revalidatePath("/contacts");
  return { success: `Added “${name.data}”.` };
}

export async function removeContactTagAction(
  contactId: string,
  tagId: string,
): Promise<ContactActionState> {
  const parsed = z
    .object({ contactId: z.string().uuid(), tagId: z.string().uuid() })
    .safeParse({ contactId, tagId });
  if (!parsed.success) return { error: "Invalid tag reference." };

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { error } = await looseFrom(supabase, "contact_tags")
    .delete()
    .eq("user_id", user.id)
    .eq("contact_id" as never, parsed.data.contactId as never)
    .eq("tag_id" as never, parsed.data.tagId as never);
  if (error) return { error: "Unable to remove that tag." };

  revalidatePath("/contacts");
  return { success: "Tag removed." };
}

export async function importContactsCsvAction(formData: FormData): Promise<CsvImportResult> {
  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const file = formData.get("file");
  const requestedBatchSize = z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .safeParse(formData.get("batchSize"));

  if (!(file instanceof File)) {
    return { error: "Choose a CSV file to import." };
  }

  if (file.size === 0) {
    return { error: "The selected file is empty." };
  }

  if (file.size > MAX_IMPORT_SIZE_BYTES) {
    return { error: "Contact files must be 2 MB or smaller." };
  }

  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
    return { error: "Unsupported file type. Use a CSV, TXT, or TSV file." };
  }

  const text = await file.text();
  const { rows, error: parseError } = parseContactsFile(text, file.name);

  if (parseError) {
    return { error: parseError };
  }

  if (rows.length === 0) {
    return { error: "No contacts were found in the selected file." };
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    return { error: `Contact imports are limited to ${MAX_IMPORT_ROWS} rows per file.` };
  }

  const seen = new Set<string>();
  const valid: Array<{
    user_id: string;
    first_name: string;
    last_name: string;
    email: string;
    company: string | null;
    phone: string | null;
    notes: string | null;
    status: ContactStatus;
    tags: string[];
  }> = [];
  const invalidRows: string[] = [];
  let inFileDuplicates = 0;

  for (const row of rows) {
    const parsed = contactSchema.safeParse({
      firstName: row.first_name || "Unknown",
      lastName: row.last_name || "Unknown",
      email: row.email,
      company: row.company,
      phone: row.phone,
      notes: row.notes,
      status: "active",
    });

    if (!parsed.success) {
      invalidRows.push(`Line ${row.line}: ${row.email || "(missing email)"}`);
      continue;
    }

    const normalized = parsed.data.email.toLowerCase();
    if (seen.has(normalized)) {
      inFileDuplicates++;
      continue;
    }
    seen.add(normalized);

    valid.push({
      user_id: user.id,
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      email: parsed.data.email,
      company: parsed.data.company,
      phone: parsed.data.phone,
      notes: parsed.data.notes,
      status: parsed.data.status,
      tags: row.tags
        .split(/[,;|]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20),
    });
  }

  if (valid.length === 0) {
    return {
      error: "No valid contacts found in the CSV.",
      invalid: invalidRows.length,
      invalidRows: invalidRows.slice(0, 10),
    };
  }

  const normalizedValidEmails = valid.map((row) => row.email.toLowerCase());
  const existingEmails = new Set<string>();
  for (let index = 0; index < normalizedValidEmails.length; index += 250) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("email_normalized")
      .eq("user_id", user.id)
      .in("email_normalized", normalizedValidEmails.slice(index, index + 250));
    for (const contact of existing ?? []) {
      existingEmails.add(contact.email_normalized);
    }
  }

  const CHUNK_SIZE = 500;
  for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
    const chunk = valid.slice(i, i + CHUNK_SIZE).map((row) => {
      const { tags, ...contact } = row;
      void tags;
      return {
        ...contact,
        source_type: "csv_import" as const,
        ...statusFlags(contact.status),
      };
    });
    const { error } = await supabase
      .from("contacts")
      .upsert(chunk as never, {
        onConflict: "user_id,email_normalized",
        ignoreDuplicates: true,
      });

    if (error) {
      return {
        error: isMissingTableError(error)
          ? MISSING_SCHEMA_MESSAGE
          : `Import failed while saving contacts: ${error.message}`,
      };
    }
  }

  const importedEmails = normalizedValidEmails.filter(
    (email) => !existingEmails.has(email),
  );
  const imported = importedEmails.length;
  const existingDuplicates = valid.length - imported;

  const rowsWithTags = valid.filter((row) => row.tags.length > 0);
  if (rowsWithTags.length > 0) {
    const normalizedEmails = [
      ...new Set(rowsWithTags.map((row) => row.email.toLowerCase())),
    ];
    const savedContacts: { id: string; email_normalized: string }[] = [];
    for (let index = 0; index < normalizedEmails.length; index += 250) {
      const { data: saved } = await supabase
        .from("contacts")
        .select("id, email_normalized")
        .eq("user_id", user.id)
        .in("email_normalized", normalizedEmails.slice(index, index + 250));
      savedContacts.push(...(saved ?? []));
    }
    const contactByEmail = new Map(
      savedContacts.map((contact) => [contact.email_normalized, contact.id]),
    );

    const uniqueTagNames = [
      ...new Set(rowsWithTags.flatMap((row) => row.tags).map((tag) => tag.trim())),
    ];
    const tagIds = new Map<string, string>();
    for (const tagName of uniqueTagNames) {
      const { data: existing } = await looseFrom(supabase, "tags")
        .select("*")
        .eq("user_id", user.id)
        .eq("name_normalized" as never, tagName.toLowerCase() as never)
        .maybeSingle();
      let tagId = (existing as unknown as { id?: string } | null)?.id;
      if (!tagId) {
        const { data: created } = await looseFrom(supabase, "tags")
          .insert({ user_id: user.id, name: tagName } as never)
          .select("*")
          .single();
        tagId = (created as unknown as { id?: string } | null)?.id;
      }
      if (tagId) tagIds.set(tagName.toLowerCase(), tagId);
    }

    const links = rowsWithTags.flatMap((row) => {
      const contactId = contactByEmail.get(row.email.toLowerCase());
      if (!contactId) return [];
      return row.tags.flatMap((tagName) => {
        const tagId = tagIds.get(tagName.toLowerCase());
        return tagId ? [{ user_id: user.id, contact_id: contactId, tag_id: tagId }] : [];
      });
    });
    if (links.length > 0) {
      await looseFrom(supabase, "contact_tags").upsert(links as never, {
        onConflict: "contact_id,tag_id",
        ignoreDuplicates: true,
      });
    }
  }

  let batchResult: {
    batch_ids?: string[];
    batches_created?: number;
    contacts_batched?: number;
    batch_size?: number;
  } = {};
  let batchError: string | undefined;
  if (importedEmails.length > 0) {
    const savedByEmail = new Map<string, string>();
    for (let index = 0; index < importedEmails.length; index += 250) {
      const { data: saved } = await supabase
        .from("contacts")
        .select("id, email_normalized")
        .eq("user_id", user.id)
        .in("email_normalized", importedEmails.slice(index, index + 250));
      for (const contact of saved ?? []) {
        savedByEmail.set(contact.email_normalized, contact.id);
      }
    }
    const orderedIds = importedEmails.flatMap((email) => {
      const id = savedByEmail.get(email);
      return id ? [id] : [];
    });
    if (orderedIds.length > 0) {
      const { data, error } = await supabase.rpc("create_contact_batches", {
        p_contact_ids: orderedIds,
        p_batch_size: requestedBatchSize.success
          ? requestedBatchSize.data
          : null,
        p_source: "import",
        p_name_prefix: "Batch",
      });
      if (error) {
        batchError =
          "Contacts were imported, but batches could not be created. Apply migration 0008 or create batches from the selection.";
      } else {
        batchResult = (data ?? {}) as typeof batchResult;
      }
    }
  }

  revalidatePath("/contacts");
  revalidatePath("/dashboard");

  return {
    imported,
    duplicates: existingDuplicates + inFileDuplicates,
    invalid: invalidRows.length,
    invalidRows: invalidRows.slice(0, 10),
    batchesCreated: batchResult.batches_created ?? 0,
    contactsBatched: batchResult.contacts_batched ?? 0,
    batchSize: batchResult.batch_size,
    batchIds: batchResult.batch_ids,
    batchError,
  };
}

export async function importPastedContactsAction(
  text: string,
  batchSize: number,
): Promise<CsvImportResult> {
  const input = z.string().max(250_000).safeParse(text);
  const size = z.coerce.number().int().min(1).max(1000).safeParse(batchSize);
  if (!input.success || !size.success) {
    return { error: "Paste contacts and choose a batch size from 1 to 1,000." };
  }

  const parsedEmails = parsePastedEmails(input.data);
  if (parsedEmails.total === 0) {
    return { error: "Paste at least one email address." };
  }
  if (parsedEmails.total > MAX_IMPORT_ROWS) {
    return { error: `Paste imports are limited to ${MAX_IMPORT_ROWS} entries.` };
  }
  const valid = parsedEmails.emails;
  if (!valid.length) {
    return {
      error: "No valid email addresses were found.",
      invalid: parsedEmails.invalid,
    };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const existing = new Set<string>();
  for (let index = 0; index < valid.length; index += 250) {
    const { data } = await supabase
      .from("contacts")
      .select("email_normalized")
      .eq("user_id", user.id)
      .in(
        "email_normalized",
        valid.slice(index, index + 250).map((email) => email.toLowerCase()),
      );
    for (const contact of data ?? []) existing.add(contact.email_normalized);
  }

  const newEmails = valid.filter((email) => !existing.has(email.toLowerCase()));
  for (let index = 0; index < newEmails.length; index += 500) {
    const { error } = await supabase.from("contacts").upsert(
      newEmails.slice(index, index + 500).map((email) => ({
        user_id: user.id,
        first_name: "",
        last_name: "",
        email,
        source_type: "manual" as const,
        status: "active" as const,
      })),
      { onConflict: "user_id,email_normalized", ignoreDuplicates: true },
    );
    if (error) return { error: "Unable to save pasted contacts." };
  }

  const idsByEmail = new Map<string, string>();
  for (let index = 0; index < newEmails.length; index += 250) {
    const { data } = await supabase
      .from("contacts")
      .select("id, email_normalized")
      .eq("user_id", user.id)
      .in(
        "email_normalized",
        newEmails.slice(index, index + 250).map((email) => email.toLowerCase()),
      );
    for (const contact of data ?? []) {
      idsByEmail.set(contact.email_normalized, contact.id);
    }
  }
  const orderedIds = newEmails.flatMap((email) => {
    const id = idsByEmail.get(email.toLowerCase());
    return id ? [id] : [];
  });

  let batches: {
    batch_ids?: string[];
    batches_created?: number;
    contacts_batched?: number;
    batch_size?: number;
  } = {};
  let batchError: string | undefined;
  if (orderedIds.length > 0) {
    const { data, error } = await supabase.rpc("create_contact_batches", {
      p_contact_ids: orderedIds,
      p_batch_size: size.data,
      p_source: "paste",
      p_name_prefix: "Batch",
    });
    if (error) {
      batchError =
        "Contacts were imported, but batches could not be created. Apply migration 0008 or batch them from Contacts.";
    } else {
      batches = (data ?? {}) as typeof batches;
    }
  }

  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return {
    imported: newEmails.length,
    duplicates:
      parsedEmails.duplicates + valid.length - newEmails.length,
    invalid: parsedEmails.invalid,
    batchesCreated: batches.batches_created ?? 0,
    contactsBatched: batches.contacts_batched ?? 0,
    batchSize: batches.batch_size,
    batchIds: batches.batch_ids,
    batchError,
  };
}
