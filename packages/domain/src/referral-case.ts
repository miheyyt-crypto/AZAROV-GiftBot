import {
  inventoryItems,
  notifications,
  referralCaseEntitlements,
  referralCaseOpenings,
  telegramAccounts,
  users,
  wallets,
} from "@giftbot/db/schema";
import { and, desc, eq, isNull, sql, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  ReferralCaseNotAvailableError,
  ReferralCaseOpenFailedError,
} from "./errors.js";
import { publicAvatarUrl } from "./https-url.js";
import { asBigInt } from "./money.js";
import {
  clampProfileListLimit,
  encodeProfileCursor,
  type ProfileListCursor,
} from "./profile-read.js";
import { pickWeightedByBigIntWeight, recordDraw } from "./rng.js";
import { applyIn } from "./wallet.js";

/** Exact scale: 100_000_000 ≡ 100.000% so 0.001% = 1_000 weight units. */
export const REFERRAL_CASE_TOTAL_WEIGHT = 100_000_000n;
export const REFERRAL_CASE_CODE = "referral" as const;

export type ReferralCaseRewardType = "azc" | "cash_rub";

export type ReferralCaseCatalogItem = {
  itemCode: string;
  title: string;
  rewardType: ReferralCaseRewardType;
  rewardAmount: bigint;
  weight: bigint;
  realChance: string;
  displayChance: string | null;
  imageKey: string;
};

export const REFERRAL_CASE_CATALOG = {
  code: REFERRAL_CASE_CODE,
  title: "Реферальный",
  priceAzc: null as null,
  requiresEntitlement: true as const,
  cashSource: "referral_case" as const,
  items: [
    {
      itemCode: "referral-cash-3000",
      title: "3 000 ₽",
      rewardType: "cash_rub" as const,
      rewardAmount: 3_000n,
      weight: 1_000n,
      realChance: "0.001",
      displayChance: null,
      imageKey: "referral-cash-3000",
    },
    {
      itemCode: "referral-cash-1000",
      title: "1 000 ₽",
      rewardType: "cash_rub" as const,
      rewardAmount: 1_000n,
      weight: 1_000n,
      realChance: "0.001",
      displayChance: null,
      imageKey: "referral-cash-1000",
    },
    {
      itemCode: "referral-azc-1500",
      title: "1 500 AZC",
      rewardType: "azc" as const,
      rewardAmount: 1_500n,
      weight: 8_000_000n,
      realChance: "8",
      displayChance: null,
      imageKey: "referral-azc-1500",
    },
    {
      itemCode: "referral-azc-6000",
      title: "6 000 AZC",
      rewardType: "azc" as const,
      rewardAmount: 6_000n,
      weight: 20_000_000n,
      realChance: "20",
      displayChance: null,
      imageKey: "referral-azc-6000",
    },
    {
      itemCode: "referral-azc-2500",
      title: "2 500 AZC",
      rewardType: "azc" as const,
      rewardAmount: 2_500n,
      weight: 30_998_000n,
      realChance: "30.998",
      displayChance: null,
      imageKey: "referral-azc-2500",
    },
    {
      itemCode: "referral-azc-1000",
      title: "1 000 AZC",
      rewardType: "azc" as const,
      rewardAmount: 1_000n,
      weight: 41_000_000n,
      realChance: "41",
      displayChance: null,
      imageKey: "referral-azc-1000",
    },
  ] as const satisfies readonly ReferralCaseCatalogItem[],
} as const;

export function referralCaseCatalogTotalWeight(
  items: readonly ReferralCaseCatalogItem[],
): bigint {
  return items.reduce((sum, item) => sum + item.weight, 0n);
}

export function assertReferralCaseCatalogIntegrity(): void {
  const total = referralCaseCatalogTotalWeight(REFERRAL_CASE_CATALOG.items);
  if (total !== REFERRAL_CASE_TOTAL_WEIGHT) {
    throw new Error(
      `referral: weight sum ${total} !== ${REFERRAL_CASE_TOTAL_WEIGHT}`,
    );
  }
  for (const item of REFERRAL_CASE_CATALOG.items) {
    if (item.weight <= 0n || item.rewardAmount <= 0n) {
      throw new Error(`referral/${item.itemCode}: invalid weight/reward`);
    }
    if (item.displayChance !== null) {
      throw new Error(
        `referral/${item.itemCode}: displayChance must stay null until product decides`,
      );
    }
  }
}

export type ReferralCasePublicCatalog = {
  code: typeof REFERRAL_CASE_CODE;
  title: string;
  priceAzc: null;
  requiresEntitlement: true;
  items: Array<{
    itemCode: string;
    title: string;
    rewardType: ReferralCaseRewardType;
    rewardAmount: string;
    displayChance: string | null;
    imageKey: string;
  }>;
};

export function getReferralCaseCatalog(): ReferralCasePublicCatalog {
  assertReferralCaseCatalogIntegrity();
  return {
    code: REFERRAL_CASE_CATALOG.code,
    title: REFERRAL_CASE_CATALOG.title,
    priceAzc: null,
    requiresEntitlement: true,
    items: REFERRAL_CASE_CATALOG.items.map((item) => ({
      itemCode: item.itemCode,
      title: item.title,
      rewardType: item.rewardType,
      rewardAmount: item.rewardAmount.toString(),
      displayChance: item.displayChance,
      imageKey: item.imageKey,
    })),
  };
}

async function readAzcBalance(tx: GiftbotTx, userId: string): Promise<string> {
  const rows = await tx
    .select({ balanceMinor: wallets.balanceMinor })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return asBigInt(rows[0]?.balanceMinor ?? 0n).toString();
}

export type ReferralCaseOpenResult = {
  openingId: string;
  caseCode: typeof REFERRAL_CASE_CODE;
  result: {
    itemCode: string;
    title: string;
    rewardType: ReferralCaseRewardType;
    rewardAmount?: string;
    rewardAmountRub?: string;
    inventoryItemId?: string;
    realChance: string;
    displayChance: string | null;
    imageKey: string;
  };
  balances: { azc: string };
  availableCases: number;
  replayed: boolean;
};

function serializeOpening(
  opening: typeof referralCaseOpenings.$inferSelect,
  balances: { azc: string },
  availableCases: number,
  replayed: boolean,
): ReferralCaseOpenResult {
  const catalog = REFERRAL_CASE_CATALOG.items.find(
    (row) => row.itemCode === opening.itemCode,
  );
  const snapshot =
    typeof opening.rewardSnapshot === "object" && opening.rewardSnapshot !== null
      ? (opening.rewardSnapshot as Record<string, unknown>)
      : {};
  const base = {
    openingId: opening.id,
    caseCode: REFERRAL_CASE_CODE,
    result: {
      itemCode: opening.itemCode,
      title: opening.titleSnapshot,
      rewardType: opening.rewardType as ReferralCaseRewardType,
      realChance: opening.realChance,
      displayChance: opening.displayChance,
      imageKey: catalog?.imageKey ?? opening.itemCode,
    },
    balances,
    availableCases,
    replayed,
  };
  if (opening.rewardType === "azc") {
    return {
      ...base,
      result: {
        ...base.result,
        rewardAmount:
          typeof snapshot.amountAzc === "string"
            ? snapshot.amountAzc
            : catalog?.rewardAmount.toString() ?? "0",
      },
    };
  }
  return {
    ...base,
    result: {
      ...base.result,
      rewardAmountRub:
        typeof snapshot.amountRub === "string"
          ? snapshot.amountRub
          : catalog?.rewardAmount.toString() ?? "0",
      ...(opening.inventoryItemId
        ? { inventoryItemId: opening.inventoryItemId }
        : {}),
    },
  };
}

async function countAvailable(
  tx: GiftbotTx,
  userId: string,
): Promise<number> {
  const rows = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(referralCaseEntitlements)
    .where(
      and(
        eq(referralCaseEntitlements.userId, userId),
        isNull(referralCaseEntitlements.consumedAt),
      ),
    );
  return Number(rows[0]?.value ?? 0);
}

export async function openReferralCase(
  db: GiftbotDb,
  input: {
    userId: string;
    idempotencyKey: string;
    clock?: Clock;
    forceItemCodeForTests?: string;
    failAfterConsumeForTests?: boolean;
  },
): Promise<ReferralCaseOpenResult> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  assertReferralCaseCatalogIntegrity();
  const clock = input.clock ?? systemClock;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`referral-case:${input.userId}:${input.idempotencyKey}`}))`,
    );

    const existing = await tx
      .select()
      .from(referralCaseOpenings)
      .where(
        and(
          eq(referralCaseOpenings.userId, input.userId),
          eq(referralCaseOpenings.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return serializeOpening(
        existing[0],
        { azc: await readAzcBalance(tx, input.userId) },
        await countAvailable(tx, input.userId),
        true,
      );
    }

    const entitlementRows = await tx
      .select()
      .from(referralCaseEntitlements)
      .where(
        and(
          eq(referralCaseEntitlements.userId, input.userId),
          isNull(referralCaseEntitlements.consumedAt),
        ),
      )
      .orderBy(asc(referralCaseEntitlements.milestoneNumber))
      .limit(1)
      .for("update");
    const entitlement = entitlementRows[0];
    if (!entitlement) {
      throw new ReferralCaseNotAvailableError();
    }

    const now = clock.now();
    await tx
      .update(referralCaseEntitlements)
      .set({ consumedAt: now })
      .where(
        and(
          eq(referralCaseEntitlements.id, entitlement.id),
          isNull(referralCaseEntitlements.consumedAt),
        ),
      );

    if (input.failAfterConsumeForTests) {
      throw new ReferralCaseOpenFailedError();
    }

    const openingId = randomUUID();
    let picked: ReferralCaseCatalogItem;
    let drawId: string | undefined;
    if (input.forceItemCodeForTests) {
      const forced = REFERRAL_CASE_CATALOG.items.find(
        (item) => item.itemCode === input.forceItemCodeForTests,
      );
      if (!forced) {
        throw new ReferralCaseOpenFailedError();
      }
      picked = forced;
    } else {
      const { row: draw, value } = await recordDraw(tx, {
        purpose: "case",
        maxExclusive: REFERRAL_CASE_TOTAL_WEIGHT,
        referenceType: "referral_case_opening",
        referenceId: openingId,
        unbiased: true,
      });
      drawId = draw.id;
      picked = pickWeightedByBigIntWeight(
        [...REFERRAL_CASE_CATALOG.items],
        value,
      );
    }

    const rewardSnapshot: Record<string, string> = {
      rewardType: picked.rewardType,
      itemCode: picked.itemCode,
      weight: picked.weight.toString(),
      realChance: picked.realChance,
    };

    let rewardTransactionId: string | undefined;
    let inventoryItemId: string | undefined;

    if (picked.rewardType === "azc") {
      const paid = await applyIn(tx, {
        userId: input.userId,
        type: "referral_case_reward",
        amountMinor: picked.rewardAmount,
        idempotencyKey: `referral_case:${openingId}:reward`,
        actorType: "system",
        reason: "Выигрыш из реферального кейса",
        referenceType: "referral_case_opening",
        referenceId: openingId,
        metadata: {
          openingId,
          caseCode: REFERRAL_CASE_CODE,
          itemCode: picked.itemCode,
          realWeight: picked.weight.toString(),
          realChance: picked.realChance,
          entitlementId: entitlement.id,
        },
      });
      rewardTransactionId = paid.transaction.id;
      rewardSnapshot.amountAzc = picked.rewardAmount.toString();
    } else {
      const inserted = await tx
        .insert(inventoryItems)
        .values({
          userId: input.userId,
          itemType: "cash_rub",
          status: "available",
          quantity: 1,
          amountRub: picked.rewardAmount,
          source: REFERRAL_CASE_CATALOG.cashSource,
          itemCode: picked.itemCode,
          title: picked.title,
          metadata: {
            caseCode: REFERRAL_CASE_CODE,
            openingId,
            imageKey: picked.imageKey,
          },
        })
        .returning();
      const inv = inserted[0];
      if (!inv) {
        throw new ReferralCaseOpenFailedError();
      }
      inventoryItemId = inv.id;
      rewardSnapshot.amountRub = picked.rewardAmount.toString();
      rewardSnapshot.inventoryItemId = inv.id;
    }

    const created = await tx
      .insert(referralCaseOpenings)
      .values({
        id: openingId,
        userId: input.userId,
        caseCode: REFERRAL_CASE_CODE,
        entitlementId: entitlement.id,
        itemCode: picked.itemCode,
        titleSnapshot: picked.title,
        rewardType: picked.rewardType,
        rewardSnapshot,
        realWeight: picked.weight,
        realChance: picked.realChance,
        displayChance: null,
        rngDrawId: drawId,
        openedAt: now,
        idempotencyKey: input.idempotencyKey,
        rewardTransactionId,
        inventoryItemId,
      })
      .returning();
    const opening = created[0];
    if (!opening) {
      throw new ReferralCaseOpenFailedError();
    }

    await tx.insert(notifications).values({
      userId: input.userId,
      channel: "inbox",
      type: "referral_case_opened",
      status: "sent",
      title:
        picked.rewardType === "azc"
          ? `Вы выиграли ${picked.title}`
          : `Вы выиграли ${picked.title}`,
      body:
        picked.rewardType === "azc"
          ? "Кейс «Реферальный»"
          : "Приз добавлен в инвентарь",
      sentAt: now,
      payload: {
        openingId: opening.id,
        caseCode: REFERRAL_CASE_CODE,
        itemCode: picked.itemCode,
        rewardType: picked.rewardType,
      },
    });

    const { evaluateAchievementsIn } = await import("./achievements.js");
    await evaluateAchievementsIn(tx, input.userId);

    return serializeOpening(
      opening,
      { azc: await readAzcBalance(tx, input.userId) },
      await countAvailable(tx, input.userId),
      false,
    );
  });
}

export type ReferralCaseHistoryItem = {
  openingId: string;
  caseCode: typeof REFERRAL_CASE_CODE;
  itemCode: string;
  title: string;
  rewardType: ReferralCaseRewardType;
  realChance: string;
  openedAt: string;
};

export async function listReferralCaseHistory(
  db: GiftbotDb,
  input: {
    userId: string;
    limit?: number;
    cursor?: ProfileListCursor;
  },
): Promise<{ items: ReferralCaseHistoryItem[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const filters = [eq(referralCaseOpenings.userId, input.userId)];
  if (input.cursor) {
    filters.push(
      sql`(${referralCaseOpenings.openedAt}, ${referralCaseOpenings.id}) < (${new Date(input.cursor.createdAt)}::timestamptz, ${input.cursor.id}::uuid)`,
    );
  }
  const rows = await db
    .select()
    .from(referralCaseOpenings)
    .where(and(...filters))
    .orderBy(desc(referralCaseOpenings.openedAt), desc(referralCaseOpenings.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const extra = rows[limit];
  return {
    items: page.map((row) => ({
      openingId: row.id,
      caseCode: REFERRAL_CASE_CODE,
      itemCode: row.itemCode,
      title: row.titleSnapshot,
      rewardType: row.rewardType as ReferralCaseRewardType,
      realChance: row.realChance,
      openedAt: row.openedAt.toISOString(),
    })),
    nextCursor: extra
      ? encodeProfileCursor({
          createdAt: extra.openedAt.toISOString(),
          id: extra.id,
        })
      : null,
  };
}

export async function listReferralCaseRecentWins(
  db: GiftbotDb,
  input: { limit?: number } = {},
): Promise<
  {
    id: string;
    source: "referral_case";
    username: string | null;
    displayName: string | null;
    publicId: string | null;
    avatarUrl: string | null;
    title: string;
    itemCode: string;
    caseCode: typeof REFERRAL_CASE_CODE;
    realChance: string;
    createdAt: string;
  }[]
> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const rows = await db
    .select({
      opening: referralCaseOpenings,
      publicId: users.publicId,
      displayName: users.displayName,
      username: telegramAccounts.username,
      photoUrl: telegramAccounts.photoUrl,
    })
    .from(referralCaseOpenings)
    .innerJoin(users, eq(users.id, referralCaseOpenings.userId))
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, referralCaseOpenings.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .orderBy(desc(referralCaseOpenings.openedAt), desc(referralCaseOpenings.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.opening.id,
    source: "referral_case" as const,
    username: row.username,
    displayName: row.displayName,
    publicId: row.publicId,
    avatarUrl: publicAvatarUrl(row.photoUrl),
    title: row.opening.titleSnapshot,
    itemCode: row.opening.itemCode,
    caseCode: REFERRAL_CASE_CODE,
    realChance: row.opening.realChance,
    createdAt: row.opening.openedAt.toISOString(),
  }));
}
