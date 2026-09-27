import { createHash, randomBytes } from "node:crypto";
import { rngDraws } from "@giftbot/db/schema";
import type { GiftbotTx } from "./db.js";

export type RngDrawRecord = typeof rngDraws.$inferSelect;

export function drawSecureInt(maxExclusive: bigint): {
  value: bigint;
  bytes: Buffer;
  hash: string;
} {
  if (maxExclusive <= 0n) {
    throw new Error("maxExclusive must be positive");
  }

  const bytes = randomBytes(32);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const raw = BigInt(`0x${bytes.toString("hex")}`);
  return {
    value: raw % maxExclusive,
    bytes,
    hash,
  };
}

/** Rejection sampling over 256-bit CSPRNG — unbiased for any maxExclusive. */
export function drawSecureIntUnbiased(maxExclusive: bigint): {
  value: bigint;
  bytes: Buffer;
  hash: string;
} {
  if (maxExclusive <= 0n) {
    throw new Error("maxExclusive must be positive");
  }
  const span = 1n << 256n;
  const limit = span - (span % maxExclusive);
  for (;;) {
    const bytes = randomBytes(32);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const raw = BigInt(`0x${bytes.toString("hex")}`);
    if (raw < limit) {
      return {
        value: raw % maxExclusive,
        bytes,
        hash,
      };
    }
  }
}

export async function recordDraw(
  tx: GiftbotTx,
  input: {
    purpose: "game" | "case" | "giveaway";
    maxExclusive: bigint;
    referenceType?: string;
    referenceId?: string;
    unbiased?: boolean;
  },
): Promise<{ row: RngDrawRecord; value: bigint }> {
  const draw = input.unbiased
    ? drawSecureIntUnbiased(input.maxExclusive)
    : drawSecureInt(input.maxExclusive);
  const inserted = await tx
    .insert(rngDraws)
    .values({
      purpose: input.purpose,
      algorithm: input.unbiased
        ? "node:crypto.randomBytes+rejection"
        : "node:crypto.randomBytes",
      entropySource: "crypto.randomBytes(32)",
      resultInt: draw.value,
      hash: draw.hash,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to record rng draw");
  }
  return { row, value: draw.value };
}

export function pickWeightedByBigIntWeight<T extends { weight: bigint }>(
  items: readonly T[],
  drawValue: bigint,
): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0n);
  if (total <= 0n) {
    throw new Error("total weight must be positive");
  }
  let cursor = drawValue % total;
  for (const item of items) {
    if (cursor < item.weight) {
      return item;
    }
    cursor -= item.weight;
  }
  const last = items[items.length - 1];
  if (!last) {
    throw new Error("no weighted items");
  }
  return last;
}
