import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assignmentBucket, variantForRecipient } from "@/features/campaigns/experiment-assign";
import {
  aggregateVariantPerformance,
  canManageCampaignExperiment,
  compareVariantPerformance,
  evenSplit,
  nextExperimentStatus,
  pickVariantForBucket,
  rememberAssignment,
  validateExperimentDraft,
  validateExperimentForStart,
  validateExperimentSetup,
  type ExperimentVariantInput,
  type VariantPerformance,
} from "@/features/campaigns/experiment-model";
import { renderCampaignEmail } from "@/lib/email/render";
import { buildUnsubscribeUrl } from "@/lib/email/unsubscribe";
import { parseCampaignTab } from "@/features/campaigns/tabs";

const EXPERIMENT_ID = "11111111-1111-4111-8111-111111111111";

function variant(
  patch: Partial<ExperimentVariantInput> & Pick<ExperimentVariantInput, "id" | "name" | "allocationPercentage">,
): ExperimentVariantInput {
  return {
    subject: `${patch.name} subject`,
    htmlContent: `<p>${patch.name} body</p>`,
    textContent: "",
    enabled: true,
    position: 0,
    ...patch,
  };
}

describe("campaign A/B experiments", () => {
  it("accepts a 50/50 test and rejects allocations that are not 100%", () => {
    const variants = [
      variant({ id: "a", name: "A", allocationPercentage: 50, position: 0 }),
      variant({ id: "b", name: "B", allocationPercentage: 50, position: 1 }),
    ];
    expect(validateExperimentSetup(variants).ok).toBe(true);
    expect(
      validateExperimentSetup([
        variant({ id: "a", name: "A", allocationPercentage: 70, position: 0 }),
        variant({ id: "b", name: "B", allocationPercentage: 20, position: 1 }),
      ]).ok,
    ).toBe(false);
  });

  it("accepts three variants and an uneven split", () => {
    expect(evenSplit(3)).toEqual([34, 33, 33]);
    const variants = [
      variant({ id: "a", name: "A", allocationPercentage: 40, position: 0 }),
      variant({ id: "b", name: "B", allocationPercentage: 30, position: 1 }),
      variant({ id: "c", name: "C", allocationPercentage: 30, position: 2 }),
    ];
    expect(validateExperimentSetup(variants).ok).toBe(true);
    expect(pickVariantForBucket(variants, 0)?.id).toBe("a");
    expect(pickVariantForBucket(variants, 39)?.id).toBe("a");
    expect(pickVariantForBucket(variants, 40)?.id).toBe("b");
    expect(pickVariantForBucket(variants, 69)?.id).toBe("b");
    expect(pickVariantForBucket(variants, 70)?.id).toBe("c");
    expect(pickVariantForBucket(variants, 99)?.id).toBe("c");
  });

  it("ignores disabled variants and refuses a test with only one enabled variant", () => {
    const variants = [
      variant({ id: "a", name: "A", allocationPercentage: 0, enabled: false, position: 0 }),
      variant({ id: "b", name: "B", allocationPercentage: 100, position: 1 }),
    ];
    expect(validateExperimentSetup(variants).ok).toBe(false);
    expect(pickVariantForBucket(variants, 10)?.id).toBe("b");
    expect(
      pickVariantForBucket(
        [variant({ id: "a", name: "A", allocationPercentage: 0, enabled: false, position: 0 })],
        10,
      ),
    ).toBeNull();
  });

  it("assigns the same recipient to the same variant every time", () => {
    const variants = [
      variant({ id: "a", name: "A", allocationPercentage: 50, position: 0 }),
      variant({ id: "b", name: "B", allocationPercentage: 50, position: 1 }),
    ];
    const first = variantForRecipient(EXPERIMENT_ID, "recipient-7", variants);
    const second = variantForRecipient(EXPERIMENT_ID, "recipient-7", variants);
    expect(first?.id).toBe(second?.id);
    expect(assignmentBucket(EXPERIMENT_ID, "recipient-7")).toBe(
      assignmentBucket(EXPERIMENT_ID, "recipient-7"),
    );
  });

  it("keeps a stored assignment when a retry proposes a different variant", () => {
    const stored = rememberAssignment("variant-a", "variant-b");
    expect(stored).toEqual({ variantId: "variant-a", inserted: false });
    expect(rememberAssignment(null, "variant-b")).toEqual({
      variantId: "variant-b",
      inserted: true,
    });
  });

  it("spreads recipients across five variants without collapsing to one", () => {
    const variants = ["a", "b", "c", "d", "e"].map((id, position) =>
      variant({ id, name: id.toUpperCase(), allocationPercentage: 20, position }),
    );
    const counts = new Map<string, number>();
    for (let index = 0; index < 2000; index += 1) {
      const chosen = variantForRecipient(EXPERIMENT_ID, `recipient-${index}`, variants);
      counts.set(chosen?.id ?? "none", (counts.get(chosen?.id ?? "none") ?? 0) + 1);
    }
    expect(counts.get("none") ?? 0).toBe(0);
    for (const id of ["a", "b", "c", "d", "e"]) {
      const count = counts.get(id) ?? 0;
      expect(count).toBeGreaterThan(300);
      expect(count).toBeLessThan(500);
    }
  });

  it("follows the experiment lifecycle and blocks other transitions", () => {
    expect(nextExperimentStatus("draft", "start")).toBe("running");
    expect(nextExperimentStatus("running", "pause")).toBe("paused");
    expect(nextExperimentStatus("paused", "resume")).toBe("running");
    expect(nextExperimentStatus("running", "complete")).toBe("completed");
    expect(nextExperimentStatus("paused", "complete")).toBe("completed");
    expect(nextExperimentStatus("completed", "start")).toBeNull();
    expect(nextExperimentStatus("running", "start")).toBeNull();
    expect(nextExperimentStatus("draft", "pause")).toBeNull();
  });

  it("aggregates sends, failures, opens, clicks, and replies per variant", () => {
    const result = aggregateVariantPerformance({
      primaryMetric: "opened",
      variants: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      assignments: [
        { recipientId: "r1", variantId: "a" },
        { recipientId: "r2", variantId: "a" },
        { recipientId: "r3", variantId: "b" },
      ],
      recipients: [
        { id: "r1", status: "sent", replied: false },
        { id: "r2", status: "failed", replied: false },
        { id: "r3", status: "sent", replied: true },
      ],
      events: [
        { recipientId: "r1", type: "opened" },
        { recipientId: "r1", type: "opened" },
        { recipientId: "r3", type: "clicked" },
      ],
    });
    const a = result.rows.find((row) => row.variantId === "a");
    const b = result.rows.find((row) => row.variantId === "b");
    expect(a).toMatchObject({ assigned: 2, sent: 1, failed: 1, opened: 1, openRate: "100.0%" });
    expect(b).toMatchObject({ assigned: 1, sent: 1, clicked: 1, replied: 1, replyRate: "100.0%" });
  });

  it("does not let a 0% variant count as a second participant", () => {
    const variants = [
      variant({ id: "a", name: "A", allocationPercentage: 100, position: 0 }),
      variant({ id: "b", name: "B", allocationPercentage: 0, position: 1 }),
    ];
    expect(validateExperimentDraft(variants).ok).toBe(true);
    expect(validateExperimentForStart(variants).ok).toBe(false);
    expect(validateExperimentSetup(variants).ok).toBe(false);
  });

  it("does not call a result from one extra event or a tiny sample", () => {
    const small = row("A", 5, 4);
    const other = row("B", 5, 1);
    expect(compareVariantPerformance([small, other], "opened").significant).toBe(false);
    expect(compareVariantPerformance([small, other], "opened").summary).toBe("Insufficient data");

    const closeA = row("A", 40, 20);
    const closeB = row("B", 40, 21);
    const close = compareVariantPerformance([closeA, closeB], "opened");
    expect(close.significant).toBe(false);
    expect(close.summary).toContain("Insufficient evidence");
    expect(close.summary.toLowerCase()).not.toContain("winner");
  });

  it("reports a difference only when both variants have enough sends and the gap is large", () => {
    const comparison = compareVariantPerformance(
      [row("A", 80, 70), row("B", 80, 20)],
      "opened",
    );
    expect(comparison.significant).toBe(true);
    expect(comparison.summary).toContain("Statistically significant difference");
    expect(comparison.summary).toContain("Variant A");
    expect(comparison.summary.toLowerCase()).not.toContain("winner");
  });

  it("handles a 0% versus 100% rate and does not treat unavailable clicks as zero", () => {
    const extreme = compareVariantPerformance(
      [row("A", 40, 40), row("B", 40, 0)],
      "opened",
    );
    expect(extreme.significant).toBe(true);

    const tied = compareVariantPerformance(
      [row("A", 40, 0), row("B", 40, 0)],
      "opened",
    );
    expect(tied.significant).toBe(false);

    const clicks = compareVariantPerformance(
      [row("A", 80, 0), row("B", 80, 0)],
      "clicked",
      { clickTracking: "unavailable" },
    );
    expect(clicks.summary).toContain("not available");
    expect(clicks.significant).toBe(false);
  });

  it("allows only the campaign owner to manage the test", () => {
    expect(canManageCampaignExperiment("user-1", "user-1")).toBe(true);
    expect(canManageCampaignExperiment("user-2", "user-1")).toBe(false);
    expect(canManageCampaignExperiment(null, "user-1")).toBe(false);
    expect(canManageCampaignExperiment(undefined, "user-1")).toBe(false);
  });

  it("still personalizes variant copy and builds an unsubscribe link", () => {
    process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret-with-32-chars";
    const rendered = renderCampaignEmail({
      subject: "Hi {{first_name}}",
      htmlContent: "<p>Hello {{company}}</p>",
      textContent: "Hello {{email}}",
      vars: {
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        company: "Analytical",
      },
    });
    expect(rendered.subject).toBe("Hi Ada");
    expect(rendered.html).toContain("Analytical");
    expect(rendered.text).toContain("ada@example.com");
    const contactId = "22222222-2222-4222-8222-222222222222";
    expect(buildUnsubscribeUrl(contactId)).toContain("/unsubscribe?token=");
  });

  it("exposes the experiment tab", () => {
    expect(parseCampaignTab("experiment")).toBe("experiment");
  });

  it("requires the campaign ownership chain in experiment policies", () => {
    for (const file of [
      "supabase/migrations/0016_campaign_experiments.sql",
      "supabase/migrations/0017_campaign_experiment_ownership.sql",
    ]) {
      const sql = readFileSync(file, "utf8");
      expect(sql).toContain("experiment_owned_by_current_user");
      expect(sql).toContain("c.user_id = auth.uid()");
      expect(sql).toContain("r.campaign_id = e.campaign_id");
      expect(sql).toContain("v.experiment_id = e.id");
      expect(sql).toContain("enforce_experiment_owner");
      expect(sql).toContain("enforce_experiment_assignment_owner");
      expect(sql).toContain("campaign_experiment_metrics");
      expect(sql).toContain(
        "grant execute on function public.campaign_experiment_metrics(uuid) to authenticated, service_role",
      );
      expect(sql).toContain("auth.role() = 'service_role'");
      expect(sql).not.toContain("delete from public.campaigns");
      expect(sql.toLowerCase()).not.toContain("drop table");
    }
  });
});

function row(name: string, sent: number, opened: number): VariantPerformance {
  return {
    variantId: name,
    name: `Variant ${name}`,
    assigned: sent,
    sent,
    failed: 0,
    opened,
    clicked: 0,
    replied: 0,
    openRate: `${((opened / sent) * 100).toFixed(1)}%`,
    clickRate: "0.0%",
    replyRate: "0.0%",
  };
}
