import { describe, expect, it } from "vitest";

import { resolveInitialExperimentMessage } from "@/features/campaigns/experiment-resolve";

const USER = "user-1";
const CAMPAIGN = "campaign-1";
const EXPERIMENT = "11111111-1111-4111-8111-111111111111";
const RECIPIENT = "recipient-1";

type Variant = {
  id: string;
  name: string;
  subject: string;
  html_content: string;
  text_content: string | null;
  allocation_percentage: number;
  enabled: boolean;
  position: number;
};

function memoryClient(input: {
  status: "draft" | "running" | "paused" | "completed";
  variants: Variant[];
  assignment?: { variant_id: string };
}) {
  const assignments = new Map<string, string>();
  if (input.assignment) assignments.set(RECIPIENT, input.assignment.variant_id);

  function assignmentQuery(recipientId: string) {
    const variantId = assignments.get(recipientId);
    return {
      maybeSingle: async () => ({
        data: variantId ? { variant_id: variantId } : null,
        error: null,
      }),
    };
  }

  return {
    assignments,
    client: {
      from(table: string) {
        if (table === "campaign_experiments") {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        maybeSingle: async () => ({
                          data: { id: EXPERIMENT, status: input.status },
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "campaign_experiment_variants") {
          return {
            select() {
              return {
                eq() {
                  return {
                    order: async () => ({ data: input.variants, error: null }),
                  };
                },
              };
            },
          };
        }
        return {
          select() {
            return {
              eq(_column: string, recipientId: string) {
                return {
                  eq(_column2: string, recipientId2: string) {
                    return assignmentQuery(recipientId2 || recipientId);
                  },
                };
              },
            };
          },
          async insert(row: { campaign_recipient_id: string; variant_id: string }) {
            if (assignments.has(row.campaign_recipient_id)) {
              return { error: { code: "23505" } };
            }
            assignments.set(row.campaign_recipient_id, row.variant_id);
            return { error: null };
          },
        };
      },
    },
  };
}

const variants: Variant[] = [
  {
    id: "variant-a",
    name: "A",
    subject: "Subject A",
    html_content: "<p>Body A</p>",
    text_content: null,
    allocation_percentage: 50,
    enabled: true,
    position: 0,
  },
  {
    id: "variant-b",
    name: "B",
    subject: "Subject B",
    html_content: "<p>Body B</p>",
    text_content: null,
    allocation_percentage: 50,
    enabled: true,
    position: 1,
  },
];

describe("experiment send resolution", () => {
  it("sends the original message when the test is still a draft", async () => {
    const { client } = memoryClient({ status: "draft", variants });
    const decision = await resolveInitialExperimentMessage(client as never, {
      userId: USER,
      campaignId: CAMPAIGN,
      recipientId: RECIPIENT,
      stepType: "initial",
    });
    expect(decision).toEqual({ action: "campaign" });
  });

  it("leaves follow-ups on their own step message", async () => {
    const { client } = memoryClient({ status: "running", variants });
    const decision = await resolveInitialExperimentMessage(client as never, {
      userId: USER,
      campaignId: CAMPAIGN,
      recipientId: RECIPIENT,
      stepType: "automated_followup",
    });
    expect(decision).toEqual({ action: "campaign" });
  });

  it("reuses a stored assignment and ignores a different proposal", async () => {
    const { client } = memoryClient({
      status: "running",
      variants,
      assignment: { variant_id: "variant-b" },
    });
    const decision = await resolveInitialExperimentMessage(client as never, {
      userId: USER,
      campaignId: CAMPAIGN,
      recipientId: RECIPIENT,
      stepType: "initial",
    });
    expect(decision).toMatchObject({
      action: "send",
      variant: { id: "variant-b", subject: "Subject B", html_content: "<p>Body B</p>" },
    });
  });

  it("sends the original message to someone never assigned after the test is completed", async () => {
    const { client, assignments } = memoryClient({ status: "completed", variants });
    const decision = await resolveInitialExperimentMessage(client as never, {
      userId: USER,
      campaignId: CAMPAIGN,
      recipientId: RECIPIENT,
      stepType: "initial",
    });
    expect(decision).toEqual({ action: "campaign" });
    expect(assignments.size).toBe(0);
  });

  it("keeps one assignment when two sends resolve the same recipient together", async () => {
    const { client, assignments } = memoryClient({ status: "running", variants });
    const [first, second] = await Promise.all([
      resolveInitialExperimentMessage(client as never, {
        userId: USER,
        campaignId: CAMPAIGN,
        recipientId: RECIPIENT,
        stepType: "initial",
      }),
      resolveInitialExperimentMessage(client as never, {
        userId: USER,
        campaignId: CAMPAIGN,
        recipientId: RECIPIENT,
        stepType: "initial",
      }),
    ]);
    expect(assignments.size).toBe(1);
    expect(first).toMatchObject({ action: "send" });
    expect(second).toMatchObject({ action: "send" });
    if (first.action === "send" && second.action === "send") {
      expect(first.variant.id).toBe(second.variant.id);
      expect(first.variant.id).toBe(assignments.get(RECIPIENT));
    }
  });
});
