import {
  manualReferralCredits,
  referralCaseEntitlements,
  referrals,
  telegramAccounts,
  users,
  wallets,
} from "@giftbot/db/schema";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { InvalidAmountError, NotFoundError } from "./errors.js";
import { asBigInt } from "./money.js";
import {
  REFERRAL_ACTIVATION_REWARD_AZC,
  REFERRAL_CASE_MILESTONE_SIZE,
  canonicalActiveReferralCount,
  countActivatedReferrals,
  grantAdditionalReferralCaseMilestones,
  sumManualReferralCredits,
  syncReferralCaseMilestones,
} from "./referral.js";
import { applyIn } from "./wallet.js";

export const MANUAL_REFERRAL_CREDIT_REASON =
  "manual/ghost referral admin credit";

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 4; i += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code: unknown }).code === "23505"
    ) {
      return true;
    }
    if (typeof current !== "object" || current === null || !("cause" in current)) {
      return false;
    }
    current = (current as { cause: unknown }).cause;
  }
  return false;
}

async function ensureWallet(
  tx: Parameters<typeof applyIn>[0],
  userId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  if (!rows[0]) {
    await tx.insert(wallets).values({ userId });
  }
}

export type ReferralCreditUser = {
  userId: string;
  publicId: string;
  telegramUsername: string | null;
  telegramUserId: string | null;
};

export async function findUserByTelegramUsername(
  db: GiftbotDb,
  username: string,
): Promise<ReferralCreditUser> {
  const needle = username.replace(/^@/, "").trim().toLowerCase();
  if (!needle) {
    throw new NotFoundError("telegram username is required");
  }
  const rows = await db
    .select({
      userId: users.id,
      publicId: users.publicId,
      username: telegramAccounts.username,
      telegramUserId: telegramAccounts.telegramUserId,
    })
    .from(telegramAccounts)
    .innerJoin(users, eq(users.id, telegramAccounts.userId))
    .where(
      and(
        eq(telegramAccounts.isActive, true),
        sql`lower(${telegramAccounts.username}) = ${needle}`,
      ),
    )
    .limit(2);
  const row = rows[0];
  if (!row || rows.length !== 1) {
    throw new NotFoundError(`user @${needle} not found`);
  }
  return {
    userId: row.userId,
    publicId: row.publicId,
    telegramUsername: row.username,
    telegramUserId: row.telegramUserId.toString(),
  };
}

export type ReferralCreditSnapshot = {
  user: ReferralCreditUser;
  realActivatedReferrals: number;
  realReferralRows: number;
  existingManualCredits: number;
  canonicalActive: number;
  casesEarned: number;
  casesAvailable: number;
  walletBalanceAzc: string;
  rewardPerReferralAzc: string;
};

async function countReferralRows(db: GiftbotDb, userId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(referrals)
    .where(eq(referrals.referrerUserId, userId));
  return Number(rows[0]?.value ?? 0);
}

async function countEntitlements(
  db: GiftbotDb | GiftbotTx,
  userId: string,
  availableOnly: boolean,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(referralCaseEntitlements)
    .where(
      availableOnly
        ? and(
            eq(referralCaseEntitlements.userId, userId),
            isNull(referralCaseEntitlements.consumedAt),
          )
        : eq(referralCaseEntitlements.userId, userId),
    );
  return Number(rows[0]?.value ?? 0);
}

export async function inspectReferralCreditState(
  db: GiftbotDb,
  user: ReferralCreditUser,
): Promise<ReferralCreditSnapshot> {
  const [
    realActivatedReferrals,
    existingManualCredits,
    realReferralRows,
    casesEarned,
    casesAvailable,
    walletRows,
  ] = await Promise.all([
    countActivatedReferrals(db, user.userId),
    sumManualReferralCredits(db, user.userId),
    countReferralRows(db, user.userId),
    countEntitlements(db, user.userId, false),
    countEntitlements(db, user.userId, true),
    db
      .select({ balanceMinor: wallets.balanceMinor })
      .from(wallets)
      .where(eq(wallets.userId, user.userId))
      .limit(1),
  ]);
  return {
    user,
    realActivatedReferrals,
    realReferralRows,
    existingManualCredits,
    canonicalActive: realActivatedReferrals + existingManualCredits,
    casesEarned,
    casesAvailable,
    walletBalanceAzc: asBigInt(walletRows[0]?.balanceMinor ?? 0n).toString(),
    rewardPerReferralAzc: REFERRAL_ACTIVATION_REWARD_AZC.toString(),
  };
}

export function previewManualReferralGrant(
  snapshot: ReferralCreditSnapshot,
  amount: number,
): {
  amount: number;
  canonicalBefore: number;
  canonicalAfter: number;
  casesEarnedBefore: number;
  casesEarnedAfter: number;
  newCaseMilestones: number;
  rewardPerReferralAzc: string;
  totalAzcReward: string;
  walletBeforeAzc: string;
  walletAfterAzc: string;
} {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new InvalidAmountError("manual referral credit amount must be a positive integer");
  }
  const canonicalAfter = snapshot.canonicalActive + amount;
  const fromCanonical = Math.max(
    0,
    Math.floor(canonicalAfter / REFERRAL_CASE_MILESTONE_SIZE) - snapshot.casesEarned,
  );
  const fromThisGrant = Math.floor(amount / REFERRAL_CASE_MILESTONE_SIZE);
  const newCaseMilestones = Math.max(fromCanonical, fromThisGrant);
  const casesEarnedAfter = snapshot.casesEarned + newCaseMilestones;
  const totalAzc = BigInt(amount) * REFERRAL_ACTIVATION_REWARD_AZC;
  const walletBefore = asBigInt(snapshot.walletBalanceAzc);
  return {
    amount,
    canonicalBefore: snapshot.canonicalActive,
    canonicalAfter,
    casesEarnedBefore: snapshot.casesEarned,
    casesEarnedAfter,
    newCaseMilestones,
    rewardPerReferralAzc: REFERRAL_ACTIVATION_REWARD_AZC.toString(),
    totalAzcReward: totalAzc.toString(),
    walletBeforeAzc: snapshot.walletBalanceAzc,
    walletAfterAzc: (walletBefore + totalAzc).toString(),
  };
}

export type GrantManualReferralCreditInput = {
  userId: string;
  amount: number;
  idempotencyKey: string;
  reason?: string;
  createdByUserId?: string;
  metadata?: Record<string, unknown>;
};

export type GrantManualReferralCreditResult = {
  replayed: boolean;
  creditId: string;
  amount: number;
  rewardTransactionId: string | null;
  canonicalActive: number;
  casesEarned: number;
  walletBalanceAzc: string;
};

export async function grantManualReferralCredit(
  db: GiftbotDb,
  input: GrantManualReferralCreditInput,
): Promise<GrantManualReferralCreditResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new InvalidAmountError(
      "manual referral credit amount must be a positive integer",
    );
  }
  const key = input.idempotencyKey.trim();
  if (!key) {
    throw new InvalidAmountError("idempotency key is required");
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(manualReferralCredits)
      .where(eq(manualReferralCredits.idempotencyKey, key))
      .limit(1);
    if (existing[0]) {
      const row = existing[0];
      if (row.userId !== input.userId || row.amount !== input.amount) {
        throw new InvalidAmountError(
          "idempotency key already used for a different manual referral credit",
        );
      }
      const walletRows = await tx
        .select({ balanceMinor: wallets.balanceMinor })
        .from(wallets)
        .where(eq(wallets.userId, input.userId))
        .limit(1);
      return {
        replayed: true,
        creditId: row.id,
        amount: row.amount,
        rewardTransactionId: row.rewardTransactionId,
        canonicalActive: await canonicalActiveReferralCount(tx, input.userId),
        casesEarned: await countEntitlements(tx, input.userId, false),
        walletBalanceAzc: asBigInt(walletRows[0]?.balanceMinor ?? 0n).toString(),
      };
    }

    await ensureWallet(tx, input.userId);

    const inserted = await tx
      .insert(manualReferralCredits)
      .values({
        userId: input.userId,
        amount: input.amount,
        reason: input.reason ?? MANUAL_REFERRAL_CREDIT_REASON,
        idempotencyKey: key,
        ...(input.createdByUserId ? { createdByUserId: input.createdByUserId } : {}),
        metadata: {
          amount: input.amount,
          kind: "manual_referral_credit",
          ...(input.metadata ?? {}),
        },
      })
      .returning()
      .catch(async (error: unknown) => {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        return [];
      });
    const credit = inserted[0];
    if (!credit) {
      const raced = await tx
        .select()
        .from(manualReferralCredits)
        .where(eq(manualReferralCredits.idempotencyKey, key))
        .limit(1);
      const row = raced[0];
      if (!row) {
        throw new Error("failed to insert manual referral credit");
      }
      const walletRows = await tx
        .select({ balanceMinor: wallets.balanceMinor })
        .from(wallets)
        .where(eq(wallets.userId, input.userId))
        .limit(1);
      return {
        replayed: true,
        creditId: row.id,
        amount: row.amount,
        rewardTransactionId: row.rewardTransactionId,
        canonicalActive: await canonicalActiveReferralCount(tx, input.userId),
        casesEarned: await countEntitlements(tx, input.userId, false),
        walletBalanceAzc: asBigInt(walletRows[0]?.balanceMinor ?? 0n).toString(),
      };
    }

    const paid = await applyIn(tx, {
      userId: input.userId,
      type: "referral_manual_credit",
      amountMinor: BigInt(input.amount) * REFERRAL_ACTIVATION_REWARD_AZC,
      idempotencyKey: `manual_referral_credit:${key}`,
      actorType: input.createdByUserId ? "admin" : "system",
      ...(input.createdByUserId ? { actorId: input.createdByUserId } : {}),
      reason: input.reason ?? MANUAL_REFERRAL_CREDIT_REASON,
      referenceType: "manual_referral_credit",
      referenceId: credit.id,
      metadata: {
        amount: input.amount,
        creditId: credit.id,
        ...(input.metadata ?? {}),
      },
    });

    await tx
      .update(manualReferralCredits)
      .set({ rewardTransactionId: paid.transaction.id })
      .where(eq(manualReferralCredits.id, credit.id));

    const casesBefore = await countEntitlements(tx, input.userId, false);
    const canonical = await canonicalActiveReferralCount(tx, input.userId);
    await syncReferralCaseMilestones(tx, input.userId, canonical);
    const casesAfterSync = await countEntitlements(tx, input.userId, false);
    const neededFromGrant = Math.floor(input.amount / REFERRAL_CASE_MILESTONE_SIZE);
    const extra = neededFromGrant - (casesAfterSync - casesBefore);
    if (extra > 0) {
      await grantAdditionalReferralCaseMilestones(tx, input.userId, extra);
    }

    const walletRows = await tx
      .select({ balanceMinor: wallets.balanceMinor })
      .from(wallets)
      .where(eq(wallets.userId, input.userId))
      .limit(1);

    return {
      replayed: false,
      creditId: credit.id,
      amount: input.amount,
      rewardTransactionId: paid.transaction.id,
      canonicalActive: canonical,
      casesEarned: await countEntitlements(tx, input.userId, false),
      walletBalanceAzc: asBigInt(walletRows[0]?.balanceMinor ?? 0n).toString(),
    };
  });
}
