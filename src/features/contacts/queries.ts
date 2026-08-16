import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type GeneratedContact = Database["public"]["Tables"]["contacts"]["Row"];

export type ContactStatus = "active" | "unsubscribed" | "bounced" | "invalid";

export type ContactTag = {
  id: string;
  name: string;
  color: string | null;
};

export type ContactCampaignHistory = {
  id: string;
  campaignName: string;
  campaignStatus: string;
  stepName: string | null;
  recipientStatus: string;
  sentAt: string | null;
  createdAt: string;
  lastError: string | null;
};

export type ContactRow = GeneratedContact & {
  company: string | null;
  phone: string | null;
  notes: string | null;
  status: ContactStatus;
  tags: ContactTag[];
  campaignHistory: ContactCampaignHistory[];
};

type LooseRecord = Record<string, unknown>;

function looseFrom(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
) {
  // Runtime schema may be ahead of generated database.types.ts during migrations.
  return supabase.from(table as "contacts");
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function statusFor(contact: LooseRecord): ContactStatus {
  const status = asString(contact.status);
  if (
    status === "active" ||
    status === "unsubscribed" ||
    status === "bounced" ||
    status === "invalid"
  ) {
    return status;
  }
  return contact.is_unsubscribed || contact.is_suppressed ? "unsubscribed" : "active";
}

export const MISSING_SCHEMA_MESSAGE =
  "The contact workspace schema is unavailable. Apply the Supabase migrations through 0004, then refresh.";

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
  tags: ContactTag[];
  error?: string;
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return {
      contacts: [],
      tags: [],
      error: isMissingTableError(error)
        ? MISSING_SCHEMA_MESSAGE
        : "Unable to load contacts right now.",
    };
  }

  const baseContacts = (data ?? []) as unknown as LooseRecord[];
  const contactIds = baseContacts
    .map((contact) => asString(contact.id))
    .filter((id): id is string => Boolean(id));

  const chunks: string[][] = [];
  for (let index = 0; index < contactIds.length; index += 100) {
    chunks.push(contactIds.slice(index, index + 100));
  }
  const [tagsResult, mappingChunks, recipientChunks, campaignsResult, stepsResult] =
    await Promise.all([
      looseFrom(supabase, "tags")
        .select("*")
        .eq("user_id", userId)
        .order("name" as never, { ascending: true }),
      Promise.all(
        chunks.map((chunk) =>
          looseFrom(supabase, "contact_tags")
            .select("*")
            .eq("user_id", userId)
            .in("contact_id" as never, chunk as never),
        ),
      ),
      Promise.all(
        chunks.map((chunk) =>
          supabase
            .from("campaign_recipients")
            .select("*")
            .eq("user_id", userId)
            .in("contact_id", chunk)
            .order("created_at", { ascending: false }),
        ),
      ),
      supabase
        .from("campaigns")
        .select("id, name, status")
        .eq("user_id", userId),
      looseFrom(supabase, "campaign_steps").select("*").eq("user_id", userId),
    ]);
  const mappingsResult = {
    data: mappingChunks.flatMap((result) => result.data ?? []),
    error: mappingChunks.find((result) => result.error)?.error ?? null,
  };
  const recipientsResult = {
    data: recipientChunks.flatMap((result) => result.data ?? []),
    error: recipientChunks.find((result) => result.error)?.error ?? null,
  };

  // Tags/history are enhancements: if their migration is still landing, the base
  // contacts list remains usable.
  const tagRecords = tagsResult.error
    ? []
    : ((tagsResult.data ?? []) as unknown as LooseRecord[]);
  const tags: ContactTag[] = tagRecords
    .map((tag) => ({
      id: asString(tag.id) ?? "",
      name: asString(tag.name) ?? "",
      color: asString(tag.color),
    }))
    .filter((tag) => tag.id && tag.name);
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const tagsByContact = new Map<string, ContactTag[]>();

  if (!mappingsResult.error) {
    for (const mapping of (mappingsResult.data ?? []) as unknown as LooseRecord[]) {
      const contactId = asString(mapping.contact_id);
      const tag = tagsById.get(asString(mapping.tag_id) ?? "");
      if (contactId && tag) {
        tagsByContact.set(contactId, [...(tagsByContact.get(contactId) ?? []), tag]);
      }
    }
  }

  const campaigns = new Map<string, { name: string; status: string }>();
  if (!campaignsResult.error) {
    for (const campaign of campaignsResult.data ?? []) {
      campaigns.set(campaign.id, { name: campaign.name, status: campaign.status });
    }
  }

  const steps = new Map<string, LooseRecord>();
  if (!stepsResult.error) {
    for (const step of (stepsResult.data ?? []) as unknown as LooseRecord[]) {
      const id = asString(step.id);
      if (id) steps.set(id, step);
    }
  }

  const historyByContact = new Map<string, ContactCampaignHistory[]>();
  if (!recipientsResult.error) {
    for (const recipient of (recipientsResult.data ?? []) as unknown as LooseRecord[]) {
      const contactId = asString(recipient.contact_id);
      const campaignId = asString(recipient.campaign_id) ?? "";
      if (!contactId) continue;
      const campaign = campaigns.get(campaignId);
      const stepId =
        asString(recipient.campaign_step_id) ?? asString(recipient.step_id) ?? "";
      const step = steps.get(stepId);
      historyByContact.set(contactId, [
        ...(historyByContact.get(contactId) ?? []),
        {
          id: asString(recipient.id) ?? `${campaignId}-${contactId}`,
          campaignName: campaign?.name ?? "Unknown campaign",
          campaignStatus: campaign?.status ?? "unknown",
          stepName:
            asString(step?.name) ??
            asString(step?.subject) ??
            (typeof step?.step_number === "number"
              ? `Step ${step.step_number}`
              : null),
          recipientStatus: asString(recipient.status) ?? "unknown",
          sentAt: asString(recipient.sent_at),
          createdAt: asString(recipient.created_at) ?? "",
          lastError: asString(recipient.last_error),
        },
      ]);
    }
  }

  const contacts = baseContacts.map((record) => {
    const id = asString(record.id) ?? "";
    return {
      ...(record as unknown as GeneratedContact),
      company: asString(record.company),
      phone: asString(record.phone),
      notes: asString(record.notes),
      status: statusFor(record),
      tags: tagsByContact.get(id) ?? [],
      campaignHistory: historyByContact.get(id) ?? [],
    };
  });

  return { contacts, tags };
}
