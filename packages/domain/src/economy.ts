import {
  caseOpenings,
  caseRewardItems,
  cases,
  products,
  purchases,
  taskCompletions,
  taskRequirements,
  tasks,
} from "@giftbot/db/schema";
import { and, eq } from "drizzle-orm";
import { readCatalogMinor } from "./catalog.js";
import type { GiftbotDb } from "./db.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { recordDraw } from "./rng.js";
import {
  assertTransition,
  caseOpeningTransitions,
  purchaseTransitions,
  taskCompletionTransitions,
} from "./states.js";
import { applyIn, type WalletApplyResult } from "./wallet.js";

export async function payoutReferralReward(): Promise<never> {
  throw new ConflictError(
    "referral payout uses activateReferralIfEligible after Kick link",
  );
}

function pickWeightedItem<T extends { weight: number }>(
  items: T[],
  drawValue: bigint,
): T {
  const total = items.reduce((sum, item) => sum + BigInt(item.weight), 0n);
  if (total <= 0n) {
    throw new ConflictError("case has no weighted rewards");
  }
  let cursor = drawValue % total;
  for (const item of items) {
    const weight = BigInt(item.weight);
    if (cursor < weight) {
      return item;
    }
    cursor -= weight;
  }
  const last = items[items.length - 1];
  if (!last) {
    throw new ConflictError("case has no weighted rewards");
  }
  return last;
}

export async function openCase(
  db: GiftbotDb,
  input: { userId: string; caseId: string; idempotencyKey: string },
): Promise<{
  openingId: string;
  status: string;
  replayed: boolean;
  resultItemId?: string;
  debitTx?: WalletApplyResult;
  prizeTx?: WalletApplyResult;
}> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(caseOpenings)
      .where(eq(caseOpenings.idempotencyKey, input.idempotencyKey))
      .limit(1);
    const already = existing[0];
    if (already) {
      return {
        openingId: already.id,
        status: already.status,
        replayed: true,
        ...(already.resultItemId ? { resultItemId: already.resultItemId } : {}),
      };
    }

    const catalog = await tx
      .select()
      .from(cases)
      .where(eq(cases.id, input.caseId))
      .limit(1);
    const row = catalog[0];
    if (!row) {
      throw new NotFoundError("case not found");
    }
    if (row.status !== "active") {
      throw new ConflictError("case is not active");
    }
    const priceMinor = readCatalogMinor(row.priceMinor);
    if (priceMinor === undefined || priceMinor <= 0n) {
      throw new ConflictError("case price is not configured");
    }

    const items = await tx
      .select()
      .from(caseRewardItems)
      .where(eq(caseRewardItems.caseId, row.id));
    const weighted = items.filter((item) => item.weight > 0);
    if (weighted.length === 0) {
      throw new ConflictError("case rewards are not configured");
    }

    const created = await tx
      .insert(caseOpenings)
      .values({
        userId: input.userId,
        caseId: row.id,
        status: "created",
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    const opening = created[0];
    if (!opening) {
      throw new Error("failed to create case opening");
    }

    const debitTx = await applyIn(tx, {
      userId: input.userId,
      type: "purchase",
      amountMinor: -priceMinor,
      idempotencyKey: `case:${opening.id}:debit`,
      actorType: "user",
      actorId: input.userId,
      referenceType: "case_opening",
      referenceId: opening.id,
    });

    const totalWeight = weighted.reduce((sum, item) => sum + BigInt(item.weight), 0n);
    const draw = await recordDraw(tx, {
      purpose: "case",
      maxExclusive: totalWeight,
      referenceType: "case_opening",
      referenceId: opening.id,
    });
    const picked = pickWeightedItem(weighted, draw.value);
    const prizeMinor = readCatalogMinor(picked.rewardMinor) ?? 0n;

    let prizeTx: WalletApplyResult | undefined;
    if (prizeMinor > 0n) {
      prizeTx = await applyIn(tx, {
        userId: input.userId,
        type: "prize",
        amountMinor: prizeMinor,
        idempotencyKey: `case:${opening.id}:prize`,
        actorType: "system",
        referenceType: "case_opening",
        referenceId: opening.id,
      });
    }

    assertTransition("case_opening", caseOpeningTransitions, "created", "settled");
    await tx
      .update(caseOpenings)
      .set({
        status: "settled",
        resultItemId: picked.id,
        debitTxId: debitTx.transaction.id,
        prizeTxId: prizeTx?.transaction.id,
      })
      .where(eq(caseOpenings.id, opening.id));

    return {
      openingId: opening.id,
      status: "settled",
      replayed: false,
      resultItemId: picked.id,
      debitTx,
      ...(prizeTx ? { prizeTx } : {}),
    };
  });
}

export async function purchaseProduct(
  db: GiftbotDb,
  input: { userId: string; productId: string; idempotencyKey: string },
): Promise<{
  purchaseId: string;
  status: string;
  replayed: boolean;
}> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.idempotencyKey, input.idempotencyKey))
      .limit(1);
    const already = existing[0];
    if (already) {
      return {
        purchaseId: already.id,
        status: already.status,
        replayed: true,
      };
    }

    const catalog = await tx
      .select()
      .from(products)
      .where(eq(products.id, input.productId))
      .for("update");
    const product = catalog[0];
    if (!product) {
      throw new NotFoundError("product not found");
    }
    if (product.status !== "active") {
      throw new ConflictError("product is not active");
    }
    const priceMinor = readCatalogMinor(product.priceMinor);
    if (priceMinor === undefined || priceMinor <= 0n) {
      throw new ConflictError("product price is not configured");
    }
    if (product.stockMode === "tracked") {
      if (product.stockRemaining === null || product.stockRemaining < 1) {
        throw new ConflictError("product is out of stock");
      }
      await tx
        .update(products)
        .set({ stockRemaining: product.stockRemaining - 1 })
        .where(eq(products.id, product.id));
    }

    const created = await tx
      .insert(purchases)
      .values({
        userId: input.userId,
        productId: product.id,
        status: "created",
        priceMinor,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    const purchase = created[0];
    if (!purchase) {
      throw new Error("failed to create purchase");
    }

    const paid = await applyIn(tx, {
      userId: input.userId,
      type: "purchase",
      amountMinor: -priceMinor,
      idempotencyKey: `purchase:${purchase.id}`,
      actorType: "user",
      actorId: input.userId,
      referenceType: "purchase",
      referenceId: purchase.id,
    });

    assertTransition("purchase", purchaseTransitions, "created", "paid");
    assertTransition("purchase", purchaseTransitions, "paid", "delivered");
    await tx
      .update(purchases)
      .set({
        status: "delivered",
        walletTransactionId: paid.transaction.id,
      })
      .where(eq(purchases.id, purchase.id));

    return { purchaseId: purchase.id, status: "delivered", replayed: false };
  });
}

export async function completeTask(
  db: GiftbotDb,
  input: { userId: string; taskId: string; idempotencyKey: string },
): Promise<{
  completionId: string;
  status: string;
  replayed: boolean;
}> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(taskCompletions)
      .where(
        and(
          eq(taskCompletions.taskId, input.taskId),
          eq(taskCompletions.userId, input.userId),
        ),
      )
      .limit(1);
    const already = existing[0];
    if (already) {
      return {
        completionId: already.id,
        status: already.status,
        replayed: true,
      };
    }

    const catalog = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .limit(1);
    const task = catalog[0];
    if (!task) {
      throw new NotFoundError("task not found");
    }
    if (task.status !== "active") {
      throw new ConflictError("task is not active");
    }

    const requirements = await tx
      .select({ id: taskRequirements.id })
      .from(taskRequirements)
      .where(eq(taskRequirements.taskId, task.id))
      .limit(1);
    if (requirements[0]) {
      throw new ConflictError("task requirements are not enabled");
    }

    const created = await tx
      .insert(taskCompletions)
      .values({
        taskId: task.id,
        userId: input.userId,
        status: "started",
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    const completion = created[0];
    if (!completion) {
      throw new Error("failed to create task completion");
    }

    const rewardMinor = readCatalogMinor(task.rewardMinor);
    if (rewardMinor === undefined || rewardMinor <= 0n) {
      assertTransition("task_completion", taskCompletionTransitions, "started", "completed");
      await tx
        .update(taskCompletions)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(taskCompletions.id, completion.id));
      return {
        completionId: completion.id,
        status: "completed",
        replayed: false,
      };
    }

    const rewarded = await applyIn(tx, {
      userId: input.userId,
      type: "reward",
      amountMinor: rewardMinor,
      idempotencyKey: `task:${completion.id}:reward`,
      actorType: "system",
      referenceType: "task_completion",
      referenceId: completion.id,
    });
    assertTransition("task_completion", taskCompletionTransitions, "started", "completed");
    assertTransition("task_completion", taskCompletionTransitions, "completed", "rewarded");
    await tx
      .update(taskCompletions)
      .set({
        status: "rewarded",
        completedAt: new Date(),
        rewardTransactionId: rewarded.transaction.id,
      })
      .where(eq(taskCompletions.id, completion.id));
    return {
      completionId: completion.id,
      status: "rewarded",
      replayed: false,
    };
  });
}
