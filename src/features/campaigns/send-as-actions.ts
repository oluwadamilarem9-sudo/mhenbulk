"use server";

import { z } from "zod";

import { listSendAsForAccount } from "@/features/campaigns/send-as";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();

export type ListSendAsAliasesState = {
  error?: string;
  warning?: string;
  preferredEmail?: string | null;
  aliasesAvailable?: boolean;
  accountId?: string;
  accountEmail?: string;
  aliases?: Array<{
    email: string;
    displayName: string | null;
    replyToAddress: string | null;
    isPrimary: boolean;
    isDefault: boolean;
  }>;
  inventory?: Array<{
    email: string;
    displayName: string | null;
    isPrimary: boolean;
    isDefault: boolean;
    usable: boolean;
    statusLabel: string;
    verificationStatus: string | null;
  }>;
  diagnostics?: {
    hasListScopeInDb: boolean;
    httpStatus: number | null;
    returnedCount: number;
    usableCount: number;
  };
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

  // Credentials are service-role only — never fall back to the user client.
  let trusted;
  try {
    trusted = createServiceRoleClient();
  } catch {
    return {
      error:
        "Server is missing SUPABASE_SERVICE_ROLE_KEY required to load Gmail send-as aliases for this account.",
    };
  }

  const result = await listSendAsForAccount(
    trusted,
    user.id,
    idResult.data,
  );
  if (!result.ok) return { error: result.error };

  return {
    accountId: result.accountId,
    accountEmail: result.accountEmail,
    aliases: result.aliases,
    inventory: result.inventory.map((item) => ({
      email: item.email,
      displayName: item.displayName,
      isPrimary: item.isPrimary,
      isDefault: item.isDefault,
      usable: item.usable,
      statusLabel: item.statusLabel,
      verificationStatus: item.verificationStatus,
    })),
    aliasesAvailable: result.aliasesAvailable,
    preferredEmail: result.preferredEmail,
    warning: result.warning,
    diagnostics: {
      hasListScopeInDb: result.diagnostics.hasListScopeInDb,
      httpStatus: result.diagnostics.httpStatus,
      returnedCount: result.diagnostics.returnedCount,
      usableCount: result.diagnostics.usableCount,
    },
  };
}
