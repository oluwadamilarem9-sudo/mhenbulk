import {
  CheckCircle2,
  Layers,
  MailCheck,
  Megaphone,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DashboardMetrics } from "@/features/dashboard/queries";
import { formatNumber } from "@/lib/utils";

type StatItem = {
  key: keyof DashboardMetrics;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: string;
};

const STATS: StatItem[] = [
  {
    key: "totalContacts",
    label: "Total contacts",
    description: "People in your audience",
    icon: Users,
    accent: "bg-sky-50 text-sky-700",
  },
  {
    key: "totalCampaigns",
    label: "Total campaigns",
    description: "Drafts and launches",
    icon: Megaphone,
    accent: "bg-violet-50 text-violet-700",
  },
  {
    key: "smartBatches",
    label: "Smart Batches",
    description: "Contact cohorts ready to send",
    icon: Layers,
    accent: "bg-amber-50 text-amber-700",
  },
  {
    key: "emailsSent",
    label: "Emails sent",
    description: "Messages with a send timestamp",
    icon: MailCheck,
    accent: "bg-indigo-50 text-indigo-700",
  },
  {
    key: "successfulEmails",
    label: "Successful emails",
    description: "Marked as sent by the queue",
    icon: CheckCircle2,
    accent: "bg-emerald-50 text-emerald-700",
  },
  {
    key: "failedEmails",
    label: "Failed emails",
    description: "Failed or bounced deliveries",
    icon: XCircle,
    accent: "bg-rose-50 text-rose-700",
  },
];

type StatsCardsProps = {
  metrics: DashboardMetrics;
};

export function StatsCards({ metrics }: StatsCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {STATS.map((stat) => {
        const Icon = stat.icon;
        const value = metrics[stat.key];
        const activeNote =
          stat.key === "smartBatches" && metrics.activeSmartBatches > 0
            ? `${formatNumber(metrics.activeSmartBatches)} scheduled, processing, or paused`
            : null;

        return (
          <Card key={stat.key}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className="mt-2 text-3xl tracking-tight">
                  {formatNumber(value)}
                </CardTitle>
              </div>
              <span
                className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${stat.accent}`}
              >
                <Icon className="h-5 w-5" />
              </span>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-500">
                {activeNote ?? stat.description}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
