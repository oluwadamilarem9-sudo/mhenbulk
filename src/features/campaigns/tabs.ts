/**
 * Shared by the campaign page (server) and the workspace UI (client). Values
 * imported from a "use client" module become client references on the server,
 * so the tab list has to live outside the client boundary.
 */
export const CAMPAIGN_TABS = [
  "overview",
  "recipients",
  "sequence",
  "experiment",
  "activity",
  "analytics",
  "settings",
] as const;

export const CAMPAIGN_TAB_LABELS: Record<(typeof CAMPAIGN_TABS)[number], string> = {
  overview: "Overview",
  recipients: "Recipients",
  sequence: "Sequence",
  experiment: "A/B test",
  activity: "Activity",
  analytics: "Analytics",
  settings: "Settings",
};

export type CampaignTab = (typeof CAMPAIGN_TABS)[number];

export function parseCampaignTab(value?: string | string[] | null): CampaignTab {
  const requested = Array.isArray(value) ? value[0] : value;
  return CAMPAIGN_TABS.find((tab) => tab === requested) ?? "overview";
}
