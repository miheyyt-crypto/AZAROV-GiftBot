import { auditLogs, users, walletTransactions, wallets } from "@giftbot/db/schema";
import { currentCorrelation } from "@giftbot/observability";
import { desc, eq } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { asBigInt } from "./money.js";
import {
  applyIn,
  reconcileWallet,
  type WalletApplyResult,
} from "./wallet.js";

export const ADMIN_LEDGER_VIEW_LIMIT = 100;

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new ConflictError("reason is required");
  }
  return trimmed;
}

export async function writeAuditIn(
  tx: GiftbotTx,
  input: {
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    requestId?: string;
  },
): Promise<string> {
  const requestId = input.requestId ?? currentCorrelation()?.requestId;
  const inserted = await tx
    .insert(auditLogs)
    .values({
      actorType: "admin",
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      ...(input.before ? { before: input.before } : {}),
      ...(input.after ? { after: input.after } : {}),
      ...(requestId ? { requestId } : {}),
    })
    .returning({ id: auditLogs.id });
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to write audit log");
  }
  return row.id;
}

export async function adjustWallet(
  db: GiftbotDb,
  input: {
    targetUserId: string;
    amountMinor: bigint;
    reason: string;
    idempotencyKey: string;
    adminUserId: string;
  },
): Promise<{
  applied: WalletApplyResult;
  auditId?: string;
  replayed: boolean;
}> {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const applied = await applyIn(tx, {
      userId: input.targetUserId,
      type: "admin_adjustment",
      amountMinor: input.amountMinor,
      idempotencyKey: input.idempotencyKey,
      actorType: "admin",
      actorId: input.adminUserId,
      reason,
      allowWhenFrozen: true,
      referenceType: "user",
      referenceId: input.targetUserId,
    });
    if (applied.replayed) {
      return { applied, replayed: true };
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "wallet.adjust",
      targetType: "wallet",
      targetId: applied.wallet.id,
      reason,
      before: { balanceMinor: (applied.wallet.balanceMinor - input.amountMinor).toString() },
      after: {
        balanceMinor: applied.wallet.balanceMinor.toString(),
        transactionId: applied.transaction.id,
      },
    });
    return { applied, auditId, replayed: false };
  });
}

export async function readAdminUserView(db: GiftbotDb, userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) {
    throw new NotFoundError("user not found");
  }
  return {
    userId: user.id,
    publicId: user.publicId,
    status: user.status,
    ...(user.displayName ? { displayName: user.displayName } : {}),
    createdAt: user.createdAt.toISOString(),
  };
}

export async function readAdminWalletView(db: GiftbotDb, userId: string) {
  await readAdminUserView(db, userId);
  const report = await reconcileWallet(db, userId);
  const walletRows = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  const wallet = walletRows[0];
  if (!wallet) {
    throw new NotFoundError("wallet not found");
  }
  return {
    userId,
    walletId: wallet.id,
    status: wallet.status,
    currencyCode: wallet.currencyCode,
    balanceMinor: report.balanceMinor.toString(),
    openingBalanceMinor: report.openingBalanceMinor.toString(),
    ledgerSumMinor: report.ledgerSumMinor.toString(),
    expectedMinor: report.expectedMinor.toString(),
    consistent: report.consistent,
  };
}

export async function readAdminLedgerView(db: GiftbotDb, userId: string) {
  await readAdminUserView(db, userId);
  const rows = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(ADMIN_LEDGER_VIEW_LIMIT);
  return {
    userId,
    entries: rows.map((row) => ({
      id: row.id,
      type: row.type,
      amountMinor: asBigInt(row.amountMinor).toString(),
      balanceAfterMinor: asBigInt(row.balanceAfterMinor).toString(),
      ...(row.reason ? { reason: row.reason } : {}),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
