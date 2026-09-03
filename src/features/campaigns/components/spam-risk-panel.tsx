"use client";

import {
  analyzeEmailSpamRisk,
  spamRiskLabel,
  type SpamRiskLevel,
} from "@/lib/email-spam-score";
import { cn } from "@/lib/utils";

type SpamRiskPanelProps = {
  subject?: string | null;
  html?: string | null;
  text?: string | null;
};

function levelClasses(level: SpamRiskLevel) {
  if (level === "high") return "border-rose-200 bg-rose-50 text-rose-800";
  if (level === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

export function SpamRiskPanel({ subject, html, text }: SpamRiskPanelProps) {
  const report = analyzeEmailSpamRisk({ subject, html, text });

  return (
    <div className={cn("rounded-xl border p-4", levelClasses(report.level))}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{spamRiskLabel(report.level)}</p>
        <p className="text-xs font-medium">Score {report.score}/100</p>
      </div>
      <p className="mt-1 text-xs opacity-90">
        This is a content warning only. It cannot guarantee inbox delivery,
        especially from personal Gmail accounts.
      </p>
      {report.findings.length ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
          {report.findings.map((finding) => (
            <li key={finding.id}>{finding.message}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs">No obvious spam phrases or risky links found.</p>
      )}
    </div>
  );
}

export function spamRiskLaunchWarning(input: {
  subject?: string | null;
  html?: string | null;
  text?: string | null;
}): string | null {
  const report = analyzeEmailSpamRisk(input);
  if (report.level === "low") return null;

  const reasons = report.findings
    .slice(0, 3)
    .map((finding) => finding.message)
    .join(" ");

  return `${spamRiskLabel(report.level)} (score ${report.score}/100). ${reasons} Launch anyway?`;
}
