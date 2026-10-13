import type { EmailAccountPublic } from "@/features/email-accounts/schemas";

const SELECTABLE_STATUS = new Set(["connected", "rate_limited"]);

export function selectableSenderAccounts(
  accounts: EmailAccountPublic[],
): EmailAccountPublic[] {
  return accounts.filter(
    (account) =>
      (account.provider === "gmail" || account.provider === "misarmail") &&
      SELECTABLE_STATUS.has(account.status),
  );
}

/** Keeps the campaign's current account. A new campaign prefers Gmail. */
export function preferredSenderAccountId(
  accounts: EmailAccountPublic[],
  currentId?: string | null,
): string | undefined {
  const selectable = selectableSenderAccounts(accounts);
  if (currentId && selectable.some((account) => account.id === currentId)) {
    return currentId;
  }
  return (
    selectable.find((account) => account.provider === "gmail")?.id ??
    selectable[0]?.id
  );
}

export function senderOptionLabel(account: EmailAccountPublic): string {
  const identity = account.display_name
    ? `${account.display_name} <${account.email}>`
    : account.email;
  const provider = account.provider === "misarmail" ? "MisarMail" : "Gmail";
  return `${provider} · ${identity}`;
}

/**
 * Blocks a campaign save or launch. Gmail's existing messages stay in place.
 * A missing account still uses the previous Gmail message.
 */
export function campaignSenderBlock(
  sender: { provider: string; status: string } | null,
): string | null {
  if (!sender || (sender.provider !== "gmail" && sender.provider !== "misarmail")) {
    return "Gmail is not connected.";
  }
  if (sender.status === "needs_reauth" || sender.status === "disconnected") {
    return sender.provider === "misarmail"
      ? "MisarMail is not connected."
      : "Your Gmail connection needs to be reauthorized.";
  }
  return null;
}
