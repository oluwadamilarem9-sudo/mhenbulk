import { createHash } from "node:crypto";

import { pickVariantForBucket, type ExperimentVariantInput } from "@/features/campaigns/experiment-model";

/** Stable 0–99 bucket. Same experiment and recipient always land in the same bucket. */
export function assignmentBucket(experimentId: string, recipientId: string): number {
  const digest = createHash("sha256").update(`${experimentId}:${recipientId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function variantForRecipient<T extends ExperimentVariantInput>(
  experimentId: string,
  recipientId: string,
  variants: T[],
): T | null {
  return pickVariantForBucket(variants, assignmentBucket(experimentId, recipientId));
}
