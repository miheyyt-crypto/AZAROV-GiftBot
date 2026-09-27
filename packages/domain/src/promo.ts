import {
  notifications,
  promoCodes,
  promoRedemptions,
  wallets,
} from "@giftbot/db/schema";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { writeAuditIn } from "./admin.js";
import {
  InvalidAmountError,
  PromoAlreadyRedeemedError,
  PromoCodeExistsError,
  PromoInactiveError,
  PromoInvalidCodeError,
  PromoLimitReachedError,
  PromoNotFoundError,
} from "./errors.js";
import { asBigInt } from "./money.js";
import {
  clampProfileListLimit,
  encodeProfileCursor,
  type ProfileListCursor,
} from "./profile-read.js";
import { applyIn } from "./wallet.js";

export const PROMO_CODE_MAX_LENGTH = 64;
export const PROMO_ACTIVATION_LIMIT_MAX = 1_000_000;
export const MAX_PROMO_AZC = 9_223_372_036_854_775_807n;
const PROMO_CODE_CHARS = /^[A-Za-z0-9_-]+$/;
const POSITIVE_AZC = /^[1-9]\d{0,18}$/;

export type PromoCodeStatus = "active" | "inactive";

export type PromoCodeRecord = {
  id: string;
  code: string;
  rewardAzc: string;
  activationLimit: number;
  activationCount: number;
  status: PromoCodeStatus;
  createdAt: string;
  deactivatedAt: string | null;
};

export type PromoRedeemResult = {
  status: "redeemed";
  rewardAzc: string;
  newBalanceAzc: string;
  replayed: boolean;
};

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

function asciiUpper(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    out += code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : char;
  }
  return out;
}

export function normalizePromoCodeInput(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new PromoInvalidCodeError();
  }
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > PROMO_CODE_MAX_LENGTH ||
    !PROMO_CODE_CHARS.test(trimmed)
  ) {
    throw new PromoInvalidCodeError();
  }
  return asciiUpper(trimmed);
}

export function displayPromoCode(raw: string): string {
  return raw.trim();
}

export function parsePositiveAzc(raw: unknown): bigint {
  if (typeof raw !== "string" || !POSITIVE_AZC.test(raw)) {
    throw new InvalidAmountError("promo reward must be a positive integer AZC");
  }
  const value = BigInt(raw);
  if (value <= 0n || value > MAX_PROMO_AZC) {
    throw new InvalidAmountError("promo reward must be a positive integer AZC");
  }
  return value;
}

export function parseActivationLimit(raw: unknown): number {
  if (typeof raw === "number") {
    if (
      !Number.isInteger(raw) ||
      raw < 1 ||
      raw > PROMO_ACTIVATION_LIMIT_MAX
    ) {
      throw new InvalidAmountError("activation limit is invalid");
    }
    return raw;
  }
  if (typeof raw === "string" && /^[1-9]\d{0,6}$/.test(raw)) {
    const parsed = Number(raw);
    if (
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > PROMO_ACTIVATION_LIMIT_MAX
    ) {
      throw new InvalidAmountError("activation limit is invalid");
    }
    return parsed;
  }
  throw new InvalidAmountError("activation limit is invalid");
}

function serializePromo(
  row: typeof promoCodes.$inferSelect,
): PromoCodeRecord {
  return {
    id: row.id,
    code: row.code,
    rewardAzc: asBigInt(row.rewardAzc).toString(),
    activationLimit: row.activationLimit,
    activationCount: row.activationCount,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    deactivatedAt: row.deactivatedAt ? row.deactivatedAt.toISOString() : null,
  };
}

async function readWalletBalanceAzc(
  tx: GiftbotTx,
  userId: string,
): Promise<string> {
  const rows = await tx
    .select({ balanceMinor: wallets.balanceMinor })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  const wallet = rows[0];
  if (!wallet) {
    throw new Error("wallet does not exist");
  }
  return asBigInt(wallet.balanceMinor).toString();
}

function walletIdempotencyKey(userId: string, httpKey: string): string {
  return `promo.redeem:${userId}:${httpKey}`;
}

async function insertInboxNotification(
  tx: GiftbotTx,
  input: {
    userId: string;
    rewardAzc: bigint;
    promoCodeId: string;
    redemptionId: string;
  },
): Promise<void> {
  await tx.insert(notifications).values({
    userId: input.userId,
    channel: "inbox",
    type: "promo_code_reward",
    status: "sent",
    title: "Промокод активирован",
    body: `Начислено ${input.rewardAzc.toString()} AZC`,
    sentAt: new Date(),
    payload: {
      promoCodeId: input.promoCodeId,
      redemptionId: input.redemptionId,
    },
  });
}

export async function redeemPromoCode(
  db: GiftbotDb,
  input: {
    userId: string;
    code: unknown;
    idempotencyKey: string;
  },
): Promise<PromoRedeemResult> {
  const normalized = normalizePromoCodeInput(input.code);
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }

  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.normalizedCode, normalized))
      .for("update")
      .limit(1);
    const promo = locked[0];
    if (!promo) {
      throw new PromoNotFoundError();
    }

    const rewardAzc = asBigInt(promo.rewardAzc);
    const existingRedemptions = await tx
      .select()
      .from(promoRedemptions)
      .where(
        and(
          eq(promoRedemptions.promoCodeId, promo.id),
          eq(promoRedemptions.userId, input.userId),
        ),
      )
      .limit(1);
    const existing = existingRedemptions[0];
    if (existing) {
      if (existing.idempotencyKey !== input.idempotencyKey) {
        throw new PromoAlreadyRedeemedError();
      }
      await applyIn(tx, {
        userId: input.userId,
        type: "promo_code_reward",
        amountMinor: rewardAzc,
        idempotencyKey: walletIdempotencyKey(input.userId, input.idempotencyKey),
        actorType: "user",
        actorId: input.userId,
        reason: "promo_code_reward",
        referenceType: "promo_redemption",
        referenceId: existing.id,
        metadata: {
          promoCodeId: promo.id,
          promoCode: promo.code,
          redemptionId: existing.id,
        },
      });
      return {
        status: "redeemed",
        rewardAzc: rewardAzc.toString(),
        newBalanceAzc: await readWalletBalanceAzc(tx, input.userId),
        replayed: true,
      };
    }

    if (promo.status !== "active") {
      throw new PromoInactiveError();
    }
    if (promo.activationCount >= promo.activationLimit) {
      throw new PromoLimitReachedError();
    }

    let redemption: typeof promoRedemptions.$inferSelect;
    try {
      const inserted = await tx
        .insert(promoRedemptions)
        .values({
          promoCodeId: promo.id,
          userId: input.userId,
          rewardAzc,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new Error("failed to insert promo redemption");
      }
      redemption = row;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await tx
        .select()
        .from(promoRedemptions)
        .where(
          and(
            eq(promoRedemptions.promoCodeId, promo.id),
            eq(promoRedemptions.userId, input.userId),
          ),
        )
        .limit(1);
      const racedRow = raced[0];
      if (racedRow && racedRow.idempotencyKey === input.idempotencyKey) {
        await applyIn(tx, {
          userId: input.userId,
          type: "promo_code_reward",
          amountMinor: rewardAzc,
          idempotencyKey: walletIdempotencyKey(
            input.userId,
            input.idempotencyKey,
          ),
          actorType: "user",
          actorId: input.userId,
          reason: "promo_code_reward",
          referenceType: "promo_redemption",
          referenceId: racedRow.id,
          metadata: {
            promoCodeId: promo.id,
            promoCode: promo.code,
            redemptionId: racedRow.id,
          },
        });
        return {
          status: "redeemed",
          rewardAzc: rewardAzc.toString(),
          newBalanceAzc: await readWalletBalanceAzc(tx, input.userId),
          replayed: true,
        };
      }
      throw new PromoAlreadyRedeemedError();
    }

    const applied = await applyIn(tx, {
      userId: input.userId,
      type: "promo_code_reward",
      amountMinor: rewardAzc,
      idempotencyKey: walletIdempotencyKey(input.userId, input.idempotencyKey),
      actorType: "user",
      actorId: input.userId,
      reason: "promo_code_reward",
      referenceType: "promo_redemption",
      referenceId: redemption.id,
      metadata: {
        promoCodeId: promo.id,
        promoCode: promo.code,
        redemptionId: redemption.id,
      },
    });
    if (applied.replayed) {
      return {
        status: "redeemed",
        rewardAzc: rewardAzc.toString(),
        newBalanceAzc: applied.wallet.balanceMinor.toString(),
        replayed: true,
      };
    }

    const incremented = await tx
      .update(promoCodes)
      .set({
        activationCount: sql`${promoCodes.activationCount} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(promoCodes.id, promo.id),
          sql`${promoCodes.activationCount} < ${promoCodes.activationLimit}`,
        ),
      )
      .returning({ id: promoCodes.id });
    if (!incremented[0]) {
      throw new PromoLimitReachedError();
    }

    await insertInboxNotification(tx, {
      userId: input.userId,
      rewardAzc,
      promoCodeId: promo.id,
      redemptionId: redemption.id,
    });

    return {
      status: "redeemed",
      rewardAzc: rewardAzc.toString(),
      newBalanceAzc: applied.wallet.balanceMinor.toString(),
      replayed: false,
    };
  });
}

export async function createPromoCode(
  db: GiftbotDb,
  input: {
    code: unknown;
    rewardAzc: unknown;
    activationLimit: unknown;
    adminUserId: string;
    idempotencyKey: string;
  },
): Promise<{ promo: PromoCodeRecord; auditId: string; replayed: boolean }> {
  const normalized = normalizePromoCodeInput(input.code);
  const display = displayPromoCode(String(input.code));
  const rewardAzc = parsePositiveAzc(input.rewardAzc);
  const activationLimit = parseActivationLimit(input.activationLimit);
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }

  return db.transaction(async (tx) => {
    try {
      const inserted = await tx
        .insert(promoCodes)
        .values({
          code: display,
          normalizedCode: normalized,
          rewardAzc,
          activationLimit,
        })
        .returning();
      const promo = inserted[0];
      if (!promo) {
        throw new Error("failed to create promo code");
      }
      const auditId = await writeAuditIn(tx, {
        actorId: input.adminUserId,
        action: "promo.create",
        targetType: "promo_code",
        targetId: promo.id,
        reason: "create promo code",
        after: {
          code: promo.code,
          normalizedCode: promo.normalizedCode,
          rewardAzc: asBigInt(promo.rewardAzc).toString(),
          activationLimit: promo.activationLimit,
          status: promo.status,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return { promo: serializePromo(promo), auditId, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      throw new PromoCodeExistsError();
    }
  });
}

export async function deactivatePromoCode(
  db: GiftbotDb,
  input: {
    promoCodeId: string;
    adminUserId: string;
    idempotencyKey: string;
  },
): Promise<{ promo: PromoCodeRecord; auditId?: string; replayed: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }

  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.id, input.promoCodeId))
      .for("update")
      .limit(1);
    const promo = locked[0];
    if (!promo) {
      throw new PromoNotFoundError();
    }
    if (promo.status === "inactive") {
      return { promo: serializePromo(promo), replayed: true };
    }
    const now = new Date();
    const updated = await tx
      .update(promoCodes)
      .set({
        status: "inactive",
        deactivatedAt: now,
        updatedAt: now,
      })
      .where(eq(promoCodes.id, promo.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to deactivate promo code");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "promo.deactivate",
      targetType: "promo_code",
      targetId: next.id,
      reason: "deactivate promo code",
      before: { status: promo.status, deactivatedAt: null },
      after: {
        status: next.status,
        deactivatedAt: next.deactivatedAt?.toISOString() ?? null,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return { promo: serializePromo(next), auditId, replayed: false };
  });
}

export async function listPromoCodes(
  db: GiftbotDb,
  input: { limit?: number; cursor?: ProfileListCursor } = {},
): Promise<{ items: PromoCodeRecord[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const cursor = input.cursor;
  const cursorFilter = cursor
    ? or(
        lt(promoCodes.createdAt, new Date(cursor.createdAt)),
        and(
          eq(promoCodes.createdAt, new Date(cursor.createdAt)),
          lt(promoCodes.id, cursor.id),
        ),
      )
    : undefined;
  const filtered = cursorFilter
    ? db.select().from(promoCodes).where(cursorFilter)
    : db.select().from(promoCodes);
  const rows = await filtered
    .orderBy(desc(promoCodes.createdAt), desc(promoCodes.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const extra = rows[limit];
  return {
    items: page.map(serializePromo),
    nextCursor: extra
      ? encodeProfileCursor({
          createdAt: extra.createdAt.toISOString(),
          id: extra.id,
        })
      : null,
  };
}
