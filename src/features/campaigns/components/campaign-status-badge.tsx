import { Badge } from "@/components/ui/badge";
import type { CampaignStatus } from "@/lib/supabase/database.types";

const statusConfig: Record<CampaignStatus, { label: string; variant: "default" | "success" | "warning" | "danger" | "info" | "muted" }> = {
  draft: { label: "Draft", variant: "muted" },
  scheduled: { label: "Scheduled", variant: "info" },
  sending: { label: "Sending", variant: "warning" },
  paused: { label: "Paused", variant: "default" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "danger" },
  failed: { label: "Failed", variant: "danger" },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const config = statusConfig[status] ?? statusConfig.draft;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
