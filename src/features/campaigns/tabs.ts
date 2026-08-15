/**
 * Shared by the campaign page (server) and the workspace UI (client). Values
 * imported from a "use client" module become client references on the server,
 * so the tab list has to live outside the client boundary.
 */
export const CAMPAIGN_TABS = [
  "overview",
  "recipients",
  "sequence",
  "activity",
  "analytics",
  "settings",
] as const;

export type CampaignTab = (typeof CAMPAIGN_TABS)[number];

export function parseCampaignTab(value?: string | string[] | null): CampaignTab {
  const requested = Array.isArray(value) ? value[0] : value;
  return CAMPAIGN_TABS.find((tab) => tab === requested) ?? "overview";
}
