"use server";

import { z } from "zod";

import { listUsableSendAsForAccount } from "@/features/campaigns/send-as";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();

export type ListSendAsAliasesState = {
  error?: string;
  warning?: string;
  preferredEmail?: string | null;
  aliasesAvailable?: boolean;
  aliases?: Array<{
    email: string;
    displayName: string | null;
    replyToAddress: string | null;
    isPrimary: boolean;
    isDefault: boolean;
  }>;
};

export async function listSendAsAliasesAction(
  emailAccountId: string,
): Promise<ListSendAsAliasesState> {
  const idResult = uuid.safeParse(emailAccountId);
  if (!idResult.success) return { error: "Invalid sending account." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  let trusted = supabase;
  try {
    trusted = createServiceRoleClient();
  } catch {
    // Fall back to user-scoped client when service role is unavailable.
  }

  const result = await listUsableSendAsForAccount(
    trusted,
    user.id,
    idResult.data,
  );
  if (!result.ok) return { error: result.error };

  return {
    aliases: result.aliases,
    aliasesAvailable: result.aliasesAvailable,
    preferredEmail: result.preferredEmail,
    warning: result.warning,
  };
}
