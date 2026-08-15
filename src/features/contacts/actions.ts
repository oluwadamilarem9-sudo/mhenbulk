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
  type ContactActionState,
  type CsvImportResult,
} from "@/features/contacts/schemas";
import { createClient } from "@/lib/supabase/server";

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

export async function createContactAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const parsed = contactSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
  });

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
  });

  if (error) {
    if (isDuplicateError(error.message)) {
      return { error: "A contact with this email already exists." };
    }
    if (isMissingTableError(error)) {
      return { error: MISSING_SCHEMA_MESSAGE };
    }
    return { error: "Unable to create the contact. Please try again." };
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
  const parsed = contactSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
  });

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
    })
    .eq("id", idResult.data)
    .eq("user_id", user.id);

  if (error) {
    if (isDuplicateError(error.message)) {
      return { error: "Another contact already uses this email." };
    }
    return { error: "Unable to update the contact. Please try again." };
  }

  revalidatePath("/contacts");
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

export async function setContactUnsubscribedAction(
  contactId: string,
  unsubscribed: boolean,
): Promise<ContactActionState> {
  const idResult = z.string().uuid().safeParse(contactId);
  if (!idResult.success) {
    return { error: "Invalid contact reference." };
  }

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
  }

  const { data: contact, error: fetchError } = await supabase
    .from("contacts")
    .select("id, email, email_normalized")
    .eq("id", idResult.data)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError || !contact) {
    return { error: "Contact not found." };
  }

  const { error } = await supabase
    .from("contacts")
    .update({ is_unsubscribed: unsubscribed })
    .eq("id", contact.id)
    .eq("user_id", user.id);

  if (error) {
    return { error: "Unable to update the contact status." };
  }

  if (unsubscribed) {
    await supabase.from("suppression_list").upsert(
      {
        user_id: user.id,
        email: contact.email,
        reason: "Manually unsubscribed",
        source: "manual",
        contact_id: contact.id,
      },
      { onConflict: "user_id,email_normalized", ignoreDuplicates: true },
    );
  } else {
    await supabase
      .from("suppression_list")
      .delete()
      .eq("user_id", user.id)
      .eq("email_normalized", contact.email_normalized);
  }

  revalidatePath("/contacts");
  return { success: unsubscribed ? "Contact unsubscribed." : "Contact resubscribed." };
}

export async function importContactsCsvAction(formData: FormData): Promise<CsvImportResult> {
  const file = formData.get("file");

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

  const { supabase, user } = await requireUser();
  if (!user) {
    return { error: "Your session has expired. Please sign in again." };
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
  }> = [];
  const invalidRows: string[] = [];
  let inFileDuplicates = 0;

  for (const row of rows) {
    const parsed = contactSchema.safeParse({
      firstName: row.first_name || "Unknown",
      lastName: row.last_name || "Unknown",
      email: row.email,
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
    });
  }

  if (valid.length === 0) {
    return {
      error: "No valid contacts found in the CSV.",
      invalid: invalidRows.length,
      invalidRows: invalidRows.slice(0, 10),
    };
  }

  const { count: beforeCount } = await supabase
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  const CHUNK_SIZE = 500;
  for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
    const chunk = valid.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from("contacts")
      .upsert(chunk, { onConflict: "user_id,email_normalized", ignoreDuplicates: true });

    if (error) {
      return {
        error: isMissingTableError(error)
          ? MISSING_SCHEMA_MESSAGE
          : `Import failed while saving contacts: ${error.message}`,
      };
    }
  }

  const { count: afterCount } = await supabase
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  const imported = Math.max((afterCount ?? 0) - (beforeCount ?? 0), 0);
  const existingDuplicates = valid.length - imported;

  revalidatePath("/contacts");
  revalidatePath("/dashboard");

  return {
    imported,
    duplicates: existingDuplicates + inFileDuplicates,
    invalid: invalidRows.length,
    invalidRows: invalidRows.slice(0, 10),
  };
}
