import { z } from "zod";

export const EXPERIMENT_STATUSES = ["draft", "running", "paused", "completed"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const EXPERIMENT_METRICS = ["opened", "clicked", "replied"] as const;
export type ExperimentPrimaryMetric = (typeof EXPERIMENT_METRICS)[number];

export const MIN_COMPARE_SENDS = 30;

export type ExperimentVariantInput = {
  id: string;
  name: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  allocationPercentage: number;
  enabled: boolean;
  position: number;
};

/** Form input for a variant. Empty subject and plain text are allowed; the message is not. */
export const experimentVariantSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Each variant needs a name.").max(80),
  subject: z.string().trim().max(300).optional().or(z.literal("")),
  htmlContent: z.string().trim().min(1).max(200_000),
  textContent: z.string().trim().max(100_000).optional().or(z.literal("")),
  allocationPercentage: z.number().int().min(0).max(100),
  enabled: z.boolean(),
});

export const experimentInputSchema = z.object({
  primaryMetric: z.enum(["opened", "clicked", "replied"]),
  variants: z.array(experimentVariantSchema).min(2).max(8),
});

export type VariantPerformance = {
  variantId: string;
  name: string;
  assigned: number;
  sent: number;
  failed: number;
  opened: number;
  clicked: number;
  replied: number;
  openRate: string;
  clickRate: string;
  replyRate: string;
};

const METRIC_LABEL: Record<ExperimentPrimaryMetric, string> = {
  opened: "open rate",
  clicked: "click rate",
  replied: "reply rate",
};

export function canManageCampaignExperiment(
  actorUserId: string | null | undefined,
  campaignOwnerId: string,
): boolean {
  return typeof actorUserId === "string" && actorUserId.length > 0 && actorUserId === campaignOwnerId;
}

export function nextExperimentStatus(
  current: ExperimentStatus,
  action: "start" | "pause" | "resume" | "complete",
): ExperimentStatus | null {
  if (action === "start" && current === "draft") return "running";
  if (action === "pause" && current === "running") return "paused";
  if (action === "resume" && current === "paused") return "running";
  if (action === "complete" && (current === "running" || current === "paused")) return "completed";
  return null;
}

export function evenSplit(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const extra = 100 - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0));
}

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
}

function fieldError(variants: ExperimentVariantInput[]): { ok: false; error: string } | null {
  if (variants.length < 2) {
    return { ok: false, error: "An A/B test needs at least two variants." };
  }
  for (const variant of variants) {
    const label = variant.name.trim() || "A variant";
    if (!variant.name.trim()) {
      return { ok: false, error: "Each variant needs a name." };
    }
    if (!visibleText(variant.htmlContent)) {
      return { ok: false, error: `${label} needs a message.` };
    }
    if (
      !Number.isInteger(variant.allocationPercentage) ||
      variant.allocationPercentage < 0 ||
      variant.allocationPercentage > 100
    ) {
      return { ok: false, error: "Allocation percentages must be whole numbers from 0 to 100." };
    }
  }
  return null;
}

/** Variants that can receive recipients. A 0% row is saved but does not participate. */
export function participatingVariants<T extends { enabled: boolean; allocationPercentage: number }>(
  variants: T[],
): T[] {
  return variants.filter((variant) => variant.enabled && variant.allocationPercentage > 0);
}

/** Drafts may include a 0% variant. They do not have to be ready to start. */
export function validateExperimentDraft(
  variants: ExperimentVariantInput[],
): { ok: true } | { ok: false; error: string } {
  return fieldError(variants) ?? { ok: true };
}

/** Start and send require two positive allocations that add up to 100%. */
export function validateExperimentForStart(
  variants: ExperimentVariantInput[],
): { ok: true } | { ok: false; error: string } {
  const fields = fieldError(variants);
  if (fields) return fields;
  const participating = participatingVariants(variants);
  if (participating.length < 2) {
    return {
      ok: false,
      error: "At least two variants need an allocation above 0% before the test can start.",
    };
  }
  const total = participating.reduce((sum, variant) => sum + variant.allocationPercentage, 0);
  if (total !== 100) {
    return { ok: false, error: "Allocations above 0% must add up to 100%." };
  }
  return { ok: true };
}

export function validateExperimentSetup(
  variants: ExperimentVariantInput[],
): { ok: true } | { ok: false; error: string } {
  return validateExperimentForStart(variants);
}

export function pickVariantForBucket<T extends ExperimentVariantInput>(
  variants: T[],
  bucket: number,
): T | null {
  const enabled = variants
    .filter((variant) => variant.enabled && variant.allocationPercentage > 0)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const total = enabled.reduce((sum, variant) => sum + variant.allocationPercentage, 0);
  if (!enabled.length || total !== 100) return null;
  const normalized = Math.min(99, Math.max(0, Math.floor(bucket)));
  let cursor = 0;
  for (const variant of enabled) {
    cursor += variant.allocationPercentage;
    if (normalized < cursor) return variant;
  }
  return enabled[enabled.length - 1] ?? null;
}

/** Unique-constraint behavior: the first stored variant wins, including retries. */
export function rememberAssignment(
  storedVariantId: string | null | undefined,
  proposedVariantId: string,
): { variantId: string; inserted: boolean } {
  if (storedVariantId) return { variantId: storedVariantId, inserted: false };
  return { variantId: proposedVariantId, inserted: true };
}

function rate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function metricCount(row: VariantPerformance, metric: ExperimentPrimaryMetric): number {
  if (metric === "opened") return row.opened;
  if (metric === "clicked") return row.clicked;
  return row.replied;
}

function metricRate(row: VariantPerformance, metric: ExperimentPrimaryMetric): number | null {
  if (row.sent <= 0) return null;
  return metricCount(row, metric) / row.sent;
}

/** Two-sided p-value for a normal approximation. */
function twoTailedP(z: number): number {
  const abs = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * abs);
  const density = 0.3989423 * Math.exp((-abs * abs) / 2);
  const tail =
    density *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const upper = abs === 0 ? 0.5 : 1 - tail;
  return Math.min(1, Math.max(0, 2 * (1 - upper)));
}

/**
 * Haldane-Anscombe correction keeps a 0% or 100% rate from making the
 * standard error zero. Every pair among variants with enough sends is tested,
 * and the p-value cutoff is 0.05 divided by the number of pairs.
 */
function correctedZ(
  successesA: number,
  sentA: number,
  successesB: number,
  sentB: number,
): number | null {
  const p1 = (successesA + 0.5) / (sentA + 1);
  const p2 = (successesB + 0.5) / (sentB + 1);
  const standardError = Math.sqrt(
    (p1 * (1 - p1)) / (sentA + 1) + (p2 * (1 - p2)) / (sentB + 1),
  );
  if (!Number.isFinite(standardError) || standardError === 0) return null;
  return (p1 - p2) / standardError;
}

export function compareVariantPerformance(
  rows: VariantPerformance[],
  metric: ExperimentPrimaryMetric,
  options?: { clickTracking?: "available" | "unavailable" },
): { summary: string; significant: boolean } {
  if (metric === "clicked" && options?.clickTracking === "unavailable") {
    return {
      summary: "Click tracking is not available for this sending account.",
      significant: false,
    };
  }

  const eligible = rows.filter((row) => row.sent >= MIN_COMPARE_SENDS);
  if (eligible.length < 2) {
    return { summary: "Insufficient data", significant: false };
  }

  const ranked = [...eligible].sort((a, b) => {
    const rateA = metricRate(a, metric) ?? 0;
    const rateB = metricRate(b, metric) ?? 0;
    return rateB - rateA || a.name.localeCompare(b.name);
  });
  const leader = ranked[0];
  const second = ranked[1];
  const leaderRate = metricRate(leader, metric);
  const secondRate = metricRate(second, metric);
  const leading =
    leaderRate != null && secondRate != null && leaderRate > secondRate
      ? `Leading: ${leader.name} on ${METRIC_LABEL[metric]}. `
      : "";

  const pairCount = (eligible.length * (eligible.length - 1)) / 2;
  const alpha = 0.05 / pairCount;
  let best: { nameA: string; nameB: string; z: number } | null = null;
  for (let i = 0; i < eligible.length; i += 1) {
    for (let j = i + 1; j < eligible.length; j += 1) {
      const left = eligible[i];
      const right = eligible[j];
      const z = correctedZ(
        metricCount(left, metric),
        left.sent,
        metricCount(right, metric),
        right.sent,
      );
      if (z == null || twoTailedP(z) >= alpha) continue;
      if (!best || Math.abs(z) > Math.abs(best.z)) {
        const leftRate = metricRate(left, metric) ?? 0;
        const rightRate = metricRate(right, metric) ?? 0;
        const ahead = leftRate >= rightRate ? left : right;
        const behind = ahead === left ? right : left;
        best = { nameA: ahead.name, nameB: behind.name, z };
      }
    }
  }

  if (!best) {
    return {
      summary: `${leading}Insufficient evidence of a statistically significant difference.`.trim(),
      significant: false,
    };
  }
  return {
    summary: `Statistically significant difference: ${best.nameA} has a higher ${METRIC_LABEL[metric]} than ${best.nameB}.`,
    significant: true,
  };
}

export function aggregateVariantPerformance(input: {
  variants: Array<{ id: string; name: string }>;
  assignments: Array<{ recipientId: string; variantId: string }>;
  recipients: Array<{ id: string; status: string; replied: boolean }>;
  events: Array<{ recipientId: string; type: string }>;
  primaryMetric: ExperimentPrimaryMetric;
  clickTracking?: "available" | "unavailable";
}): { rows: VariantPerformance[]; comparison: { summary: string; significant: boolean } } {
  const recipients = new Map(input.recipients.map((recipient) => [recipient.id, recipient]));
  const opened = new Set<string>();
  const clicked = new Set<string>();
  for (const event of input.events) {
    if (event.type === "opened") opened.add(event.recipientId);
    if (event.type === "clicked") clicked.add(event.recipientId);
  }

  const rows = input.variants.map((variant) => {
    const assignedIds = input.assignments
      .filter((assignment) => assignment.variantId === variant.id)
      .map((assignment) => assignment.recipientId);
    let sent = 0;
    let failed = 0;
    let openedCount = 0;
    let clickedCount = 0;
    let replied = 0;
    for (const recipientId of assignedIds) {
      const recipient = recipients.get(recipientId);
      if (!recipient) continue;
      if (recipient.status === "sent" || recipient.status === "replied") sent++;
      if (recipient.status === "failed" || recipient.status === "bounced") failed++;
      if (opened.has(recipientId)) openedCount++;
      if (clicked.has(recipientId)) clickedCount++;
      if (recipient.replied || recipient.status === "replied") replied++;
    }
    return {
      variantId: variant.id,
      name: variant.name,
      assigned: assignedIds.length,
      sent,
      failed,
      opened: openedCount,
      clicked: clickedCount,
      replied,
      openRate: rate(openedCount, sent),
      clickRate:
        input.clickTracking === "unavailable" ? "Not available" : rate(clickedCount, sent),
      replyRate: rate(replied, sent),
    };
  });

  return {
    rows,
    comparison: compareVariantPerformance(rows, input.primaryMetric, {
      clickTracking: input.clickTracking,
    }),
  };
}
