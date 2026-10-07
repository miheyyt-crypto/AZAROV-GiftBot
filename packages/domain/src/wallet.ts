import {
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { correlationMetadata } from "@giftbot/observability";
import { eq } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  InsufficientFundsError,
  WalletFrozenError,
  WalletNotFoundError,
} from "./errors.js";
import { asBigInt, assertAmountForType } from "./money.js";

export type WalletActorType = "system" | "user" | "admin" | "worker";

export type WalletTransactionType =
  | "deposit"
  | "reward"
  | "referral_reward"
  | "purchase"
  | "bet"
  | "prize"
  | "refund"
  | "admin_adjustment"
  | "reversal"
  | "promo_code_reward"
  | "shop_purchase"
  | "shop_refund"
  | "free_case_reward"
  | "paid_case_purchase"
  | "paid_case_reward"
  | "referral_inviter_reward"
  | "referral_referred_reward"
  | "referral_manual_credit"
  | "referral_case_reward"
  | "task_reward"
  | "welvura_deposit_reward"
  | "level_reward"
  | "stream_streak_reward"
  | "mines_bet"
  | "mines_win"
  | "dice_bet"
  | "dice_win"
  | "rolls_bet"
  | "rolls_win"
  | "giveaway_reward"
  | "achievement_reward"
  | "referral_contest_reward"
  | "stream_donation";

export type WalletApplyInput = {
  userId: string;
  type: WalletTransactionType;
  amountMinor: bigint;
  idempotencyKey: string;
  actorType: WalletActorType;
  actorId?: string;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
  reversesTransactionId?: string;
  metadata?: Record<string, unknown>;
  allowWhenFrozen?: boolean;
};

export type LedgerRow = typeof walletTransactions.$inferSelect;

export type WalletSnapshot = {
  id: string;
  userId: string;
  balanceMinor: bigint;
  openingBalanceMinor: bigint;
  version: bigint;
  status: "active" | "frozen";
};

export type WalletApplyResult = {
  transaction: LedgerRow;
  replayed: boolean;
  wallet: WalletSnapshot;
};

function snapshot(
  row: typeof wallets.$inferSelect,
): WalletSnapshot {
  return {
    id: row.id,
    userId: row.userId,
    balanceMinor: asBigInt(row.balanceMinor),
    openingBalanceMinor: asBigInt(row.openingBalanceMinor),
    version: asBigInt(row.version),
    status: row.status,
  };
}

async function loadWalletForUpdate(
  tx: GiftbotTx,
  userId: string,
): Promise<typeof wallets.$inferSelect> {
  const rows = await tx
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .for("update");
  const wallet = rows[0];
  if (!wallet) {
    throw new WalletNotFoundError();
  }
  return wallet;
}

export async function applyIn(
  tx: GiftbotTx,
  input: WalletApplyInput,
): Promise<WalletApplyResult> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  assertAmountForType(input.type, input.amountMinor);

  const wallet = await loadWalletForUpdate(tx, input.userId);

  const existing = await tx
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.idempotencyKey, input.idempotencyKey))
    .limit(1);
  const replay = existing[0];
  if (replay) {
    return { transaction: replay, replayed: true, wallet: snapshot(wallet) };
  }

  if (wallet.status === "frozen") {
    const adminOverride =
      input.allowWhenFrozen === true && input.actorType === "admin";
    if (!adminOverride) {
      throw new WalletFrozenError();
    }
  }

  const current = asBigInt(wallet.balanceMinor);
  const next = current + input.amountMinor;
  if (next < 0n) {
    throw new InsufficientFundsError();
  }

  const inserted = await tx
    .insert(walletTransactions)
    .values({
      walletId: wallet.id,
      userId: input.userId,
      type: input.type,
      amountMinor: input.amountMinor,
      balanceAfterMinor: next,
      idempotencyKey: input.idempotencyKey,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reversesTransactionId: input.reversesTransactionId,
      actorType: input.actorType,
      actorId: input.actorId,
      reason: input.reason,
      metadata: {
        ...(input.metadata ?? {}),
        ...correlationMetadata(),
      },
    })
    .returning();
  const transaction = inserted[0];
  if (!transaction) {
    throw new Error("failed to insert ledger row");
  }

  const updated = await tx
    .update(wallets)
    .set({
      balanceMinor: next,
      version: asBigInt(wallet.version) + 1n,
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, wallet.id))
    .returning();
  const nextWallet = updated[0];
  if (!nextWallet) {
    throw new Error("failed to update wallet projection");
  }

  return {
    transaction,
    replayed: false,
    wallet: snapshot(nextWallet),
  };
}

export async function apply(
  db: GiftbotDb,
  input: WalletApplyInput,
): Promise<WalletApplyResult> {
  return db.transaction((tx) => applyIn(tx, input));
}

export async function reverse(
  db: GiftbotDb,
  input: {
    userId: string;
    originalTransactionId: string;
    actorType: WalletActorType;
    actorId?: string;
    reason?: string;
  },
): Promise<WalletApplyResult> {
  return db.transaction(async (tx) => {
    const originalRows = await tx
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.id, input.originalTransactionId))
      .limit(1);
    const original = originalRows[0];
    if (!original) {
      throw new WalletNotFoundError();
    }

    const reversal: WalletApplyInput = {
      userId: input.userId,
      type: "reversal",
      amountMinor: -asBigInt(original.amountMinor),
      idempotencyKey: `rev:${original.id}`,
      actorType: input.actorType,
      reversesTransactionId: original.id,
      referenceType: "wallet_transaction",
      referenceId: original.id,
    };
    if (input.actorId) {
      reversal.actorId = input.actorId;
    }
    if (input.reason) {
      reversal.reason = input.reason;
    }
    return applyIn(tx, reversal);
  });
}

export type ReconcileResult = {
  walletId: string;
  userId: string;
  balanceMinor: bigint;
  openingBalanceMinor: bigint;
  ledgerSumMinor: bigint;
  expectedMinor: bigint;
  consistent: boolean;
};

export async function reconcileWallet(
  db: GiftbotDb,
  userId: string,
): Promise<ReconcileResult> {
  const walletRows = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  const wallet = walletRows[0];
  if (!wallet) {
    throw new WalletNotFoundError();
  }

  const ledger = await db
    .select({
      amountMinor: walletTransactions.amountMinor,
    })
    .from(walletTransactions)
    .where(eq(walletTransactions.walletId, wallet.id));

  const ledgerSumMinor = ledger.reduce(
    (sum, row) => sum + asBigInt(row.amountMinor),
    0n,
  );
  const openingBalanceMinor = asBigInt(wallet.openingBalanceMinor);
  const balanceMinor = asBigInt(wallet.balanceMinor);
  const expectedMinor = openingBalanceMinor + ledgerSumMinor;

  return {
    walletId: wallet.id,
    userId: wallet.userId,
    balanceMinor,
    openingBalanceMinor,
    ledgerSumMinor,
    expectedMinor,
    consistent: balanceMinor === expectedMinor,
  };
}

export async function reconcileAllWallets(
  db: GiftbotDb,
): Promise<ReconcileResult[]> {
  const rows = await db.select({ userId: wallets.userId }).from(wallets);
  const reports: ReconcileResult[] = [];
  for (const row of rows) {
    reports.push(await reconcileWallet(db, row.userId));
  }
  return reports;
}
