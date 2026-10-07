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

export function validateExperimentSetup(
  variants: ExperimentVariantInput[],
): { ok: true } | { ok: false; error: string } {
  if (variants.length < 2) {
    return { ok: false, error: "An A/B test needs at least two variants." };
  }
  const enabled = variants.filter((variant) => variant.enabled);
  if (enabled.length < 2) {
    return { ok: false, error: "Enable at least two variants before starting the test." };
  }
  for (const variant of variants) {
    const label = variant.name.trim() || "A variant";
    if (!variant.name.trim()) {
      return { ok: false, error: "Each variant needs a name." };
    }
    if (!variant.subject.trim()) {
      return { ok: false, error: `${label} needs a subject.` };
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
  const total = enabled.reduce((sum, variant) => sum + variant.allocationPercentage, 0);
  if (total !== 100) {
    return { ok: false, error: "Enabled variant allocations must add up to 100%." };
  }
  return { ok: true };
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

export function compareVariantPerformance(
  rows: VariantPerformance[],
  metric: ExperimentPrimaryMetric,
): { summary: string; significant: boolean } {
  const ranked = rows
    .map((row) => ({ row, rate: metricRate(row, metric) }))
    .filter((entry): entry is { row: VariantPerformance; rate: number } => entry.rate != null)
    .sort((a, b) => b.rate - a.rate || a.row.name.localeCompare(b.row.name));

  if (ranked.length < 2 || ranked[0].row.sent < MIN_COMPARE_SENDS || ranked[1].row.sent < MIN_COMPARE_SENDS) {
    return { summary: "Not enough sends to compare variants.", significant: false };
  }

  const [leader, runnerUp] = ranked;
  if (leader.rate === runnerUp.rate) {
    return { summary: "No variant is far enough ahead to call a result.", significant: false };
  }

  const leaderHits = metricCount(leader.row, metric);
  const runnerHits = metricCount(runnerUp.row, metric);
  const pooled =
    (leaderHits + runnerHits) / (leader.row.sent + runnerUp.row.sent);
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / leader.row.sent + 1 / runnerUp.row.sent),
  );
  if (!Number.isFinite(standardError) || standardError === 0) {
    return { summary: "No variant is far enough ahead to call a result.", significant: false };
  }
  const z = (leader.rate - runnerUp.rate) / standardError;
  if (twoTailedP(z) >= 0.05) {
    return { summary: "No variant is far enough ahead to call a result.", significant: false };
  }
  return {
    summary: `${leader.row.name} has a higher ${METRIC_LABEL[metric]} than ${runnerUp.row.name}. The gap is large enough to treat as a difference. This is not a guarantee for future sends.`,
    significant: true,
  };
}

export function aggregateVariantPerformance(input: {
  variants: Array<{ id: string; name: string }>;
  assignments: Array<{ recipientId: string; variantId: string }>;
  recipients: Array<{ id: string; status: string; replied: boolean }>;
  events: Array<{ recipientId: string; type: string }>;
  primaryMetric: ExperimentPrimaryMetric;
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
      clickRate: rate(clickedCount, sent),
      replyRate: rate(replied, sent),
    };
  });

  return {
    rows,
    comparison: compareVariantPerformance(rows, input.primaryMetric),
  };
}
