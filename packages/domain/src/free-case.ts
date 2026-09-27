import { randomUUID } from "node:crypto";
import {
  freeCaseOpenings,
  freeCaseUserState,
  gramBalances,
  inventoryItems,
  notifications,
  telegramAccounts,
  users,
  wallets,
} from "@giftbot/db/schema";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  ConflictError,
  FreeCaseCooldownActiveError,
  FreeCaseOpenFailedError,
} from "./errors.js";
import { GRAM_MINOR_PER_UNIT, formatGramMinor } from "./gram.js";
import { publicAvatarUrl } from "./https-url.js";
import { asBigInt } from "./money.js";
import { listPaidRecentWins } from "./paid-case.js";
import { listReferralCaseRecentWins } from "./referral-case.js";
import {
  clampProfileListLimit,
  encodeProfileCursor,
  type ProfileListCursor,
} from "./profile-read.js";
import { pickWeightedByBigIntWeight, recordDraw } from "./rng.js";
import { applyIn } from "./wallet.js";

/**
 * Integer weight scale: totalWeight = 600_000 ≡ 100%.
 * Legendary each 6 → 0.001%; Epic each 12 → 0.002%;
 * Common each 99_986 → equal share of 99.986%.
 */
export const FREE_CASE_TOTAL_WEIGHT = 600_000n;
export const FREE_CASE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const FREE_CASE_CODE = "free" as const;

export type FreeCaseRarity = "legendary" | "epic" | "common";
export type FreeCaseRewardType = "azc" | "gram" | "external";

export type FreeCaseCatalogItem = {
  itemCode: string;
  title: string;
  rarity: FreeCaseRarity;
  rewardType: FreeCaseRewardType;
  /** AZC whole units or Gram minor units; null for external */
  rewardAmount: bigint | null;
  /** RNG weight — NEVER use displayChance for draws */
  weight: bigint;
  /** Player-facing percent string — NEVER use for RNG */
  displayChance: string;
  /** Real percent string for audits / recent wins */
  realChance: string;
  imageKey: string;
};

export const FREE_CASE_CATALOG: readonly FreeCaseCatalogItem[] = [
  {
    itemCode: "gram-100",
    title: "100 Gram",
    rarity: "legendary",
    rewardType: "gram",
    rewardAmount: 100n * GRAM_MINOR_PER_UNIT,
    weight: 6n,
    displayChance: "1",
    realChance: "0.001",
    imageKey: "gram-100",
  },
  {
    itemCode: "gram-50",
    title: "50 Gram",
    rarity: "legendary",
    rewardType: "gram",
    rewardAmount: 50n * GRAM_MINOR_PER_UNIT,
    weight: 6n,
    displayChance: "1",
    realChance: "0.001",
    imageKey: "gram-50",
  },
  {
    itemCode: "nft-durovs-glass",
    title: "Durov's Glass NFT",
    rarity: "legendary",
    rewardType: "external",
    rewardAmount: null,
    weight: 6n,
    displayChance: "1",
    realChance: "0.001",
    imageKey: "nft-durovs-glass",
  },
  {
    itemCode: "nft-loot-bag",
    title: "Loot Bag NFT",
    rarity: "legendary",
    rewardType: "external",
    rewardAmount: null,
    weight: 6n,
    displayChance: "1",
    realChance: "0.001",
    imageKey: "nft-loot-bag",
  },
  {
    itemCode: "nft-diamond-ring",
    title: "Diamond Ring NFT",
    rarity: "legendary",
    rewardType: "external",
    rewardAmount: null,
    weight: 6n,
    displayChance: "1",
    realChance: "0.001",
    imageKey: "nft-diamond-ring",
  },
  {
    itemCode: "nft-swiss-watch",
    title: "Swiss Watch NFT",
    rarity: "legendary",
    rewardType: "external",
    rewardAmount: null,
    weight: 6n,
    displayChance: "1",
    realChance: "0.001",
    imageKey: "nft-swiss-watch",
  },
  {
    itemCode: "gram-2",
    title: "2 Gram",
    rarity: "epic",
    rewardType: "gram",
    rewardAmount: 2n * GRAM_MINOR_PER_UNIT,
    weight: 12n,
    displayChance: "5",
    realChance: "0.002",
    imageKey: "gram-2",
  },
  {
    itemCode: "gram-1",
    title: "1 Gram",
    rarity: "epic",
    rewardType: "gram",
    rewardAmount: 1n * GRAM_MINOR_PER_UNIT,
    weight: 12n,
    displayChance: "5",
    realChance: "0.002",
    imageKey: "gram-1",
  },
  {
    itemCode: "gram-05",
    title: "0.5 Gram",
    rarity: "epic",
    rewardType: "gram",
    rewardAmount: 500_000_000n,
    weight: 12n,
    displayChance: "5",
    realChance: "0.002",
    imageKey: "gram-05",
  },
  {
    itemCode: "gram-02",
    title: "0.2 Gram",
    rarity: "epic",
    rewardType: "gram",
    rewardAmount: 200_000_000n,
    weight: 12n,
    displayChance: "5",
    realChance: "0.002",
    imageKey: "gram-02",
  },
  {
    itemCode: "gram-001",
    title: "0.01 Gram",
    rarity: "common",
    rewardType: "gram",
    rewardAmount: 10_000_000n,
    weight: 99_986n,
    displayChance: "12.33",
    realChance: "16.664333333333",
    imageKey: "gram-001",
  },
  {
    itemCode: "gram-0005",
    title: "0.005 Gram",
    rarity: "common",
    rewardType: "gram",
    rewardAmount: 5_000_000n,
    weight: 99_986n,
    displayChance: "12.33",
    realChance: "16.664333333333",
    imageKey: "gram-0005",
  },
  {
    itemCode: "gram-0001",
    title: "0.001 Gram",
    rarity: "common",
    rewardType: "gram",
    rewardAmount: 1_000_000n,
    weight: 99_986n,
    displayChance: "12.33",
    realChance: "16.664333333333",
    imageKey: "gram-0001",
  },
  {
    itemCode: "azc-100",
    title: "100 AZC",
    rarity: "common",
    rewardType: "azc",
    rewardAmount: 100n,
    weight: 99_986n,
    displayChance: "12.33",
    realChance: "16.664333333333",
    imageKey: "azc-100",
  },
  {
    itemCode: "azc-50",
    title: "50 AZC",
    rarity: "common",
    rewardType: "azc",
    rewardAmount: 50n,
    weight: 99_986n,
    displayChance: "12.33",
    realChance: "16.664333333333",
    imageKey: "azc-50",
  },
  {
    itemCode: "azc-25",
    title: "25 AZC",
    rarity: "common",
    rewardType: "azc",
    rewardAmount: 25n,
    weight: 99_986n,
    displayChance: "12.33",
    realChance: "16.664333333333",
    imageKey: "azc-25",
  },
];

export const FREE_CASE_DISPLAY_TOTALS = {
  legendary: "6",
  epic: "20",
  common: "74",
} as const;

const BY_CODE = new Map(FREE_CASE_CATALOG.map((item) => [item.itemCode, item]));

export function freeCaseCatalogTotalWeight(): bigint {
  return FREE_CASE_CATALOG.reduce((sum, item) => sum + item.weight, 0n);
}

export function assertFreeCaseCatalogIntegrity(): void {
  if (FREE_CASE_CATALOG.length !== 16) {
    throw new Error("free case must have 16 items");
  }
  const legendary = FREE_CASE_CATALOG.filter((i) => i.rarity === "legendary");
  const epic = FREE_CASE_CATALOG.filter((i) => i.rarity === "epic");
  const common = FREE_CASE_CATALOG.filter((i) => i.rarity === "common");
  if (legendary.length !== 6 || epic.length !== 4 || common.length !== 6) {
    throw new Error("free case rarity counts are wrong");
  }
  if (freeCaseCatalogTotalWeight() !== FREE_CASE_TOTAL_WEIGHT) {
    throw new Error("free case total weight must equal 600000");
  }
}

export type FreeCasePublicItem = {
  itemCode: string;
  title: string;
  rarity: FreeCaseRarity;
  rewardType: FreeCaseRewardType;
  displayChance: string;
  imageKey: string;
};

export function publicFreeCaseCatalog(): FreeCasePublicItem[] {
  return FREE_CASE_CATALOG.map((item) => ({
    itemCode: item.itemCode,
    title: item.title,
    rarity: item.rarity,
    rewardType: item.rewardType,
    displayChance: item.displayChance,
    imageKey: item.imageKey,
  }));
}

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

async function ensureWallet(tx: GiftbotTx, userId: string): Promise<void> {
  const rows = await tx
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  if (!rows[0]) {
    await tx.insert(wallets).values({ userId });
  }
}

async function creditGramIn(
  tx: GiftbotTx,
  userId: string,
  amountMinor: bigint,
): Promise<bigint> {
  if (amountMinor <= 0n) {
    throw new FreeCaseOpenFailedError();
  }
  const locked = await tx
    .select()
    .from(gramBalances)
    .where(eq(gramBalances.userId, userId))
    .for("update")
    .limit(1);
  const row = locked[0];
  if (!row) {
    await tx.insert(gramBalances).values({
      userId,
      amountMinor,
      reservedMinor: 0n,
    });
    return amountMinor;
  }
  const next = asBigInt(row.amountMinor) + amountMinor;
  await tx
    .update(gramBalances)
    .set({ amountMinor: next, updatedAt: new Date() })
    .where(eq(gramBalances.userId, userId));
  return next;
}

async function readBalances(tx: GiftbotTx, userId: string) {
  const walletRows = await tx
    .select({ balanceMinor: wallets.balanceMinor })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  const gramRows = await tx
    .select({
      amountMinor: gramBalances.amountMinor,
      reservedMinor: gramBalances.reservedMinor,
    })
    .from(gramBalances)
    .where(eq(gramBalances.userId, userId))
    .limit(1);
  return {
    azc: asBigInt(walletRows[0]?.balanceMinor ?? 0n).toString(),
    gram: formatGramMinor(asBigInt(gramRows[0]?.amountMinor ?? 0n)),
  };
}

async function lockOrCreateUserState(tx: GiftbotTx, userId: string) {
  const existing = await tx
    .select()
    .from(freeCaseUserState)
    .where(eq(freeCaseUserState.userId, userId))
    .for("update")
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }
  try {
    const inserted = await tx
      .insert(freeCaseUserState)
      .values({
        userId,
        nextAvailableAt: new Date(0),
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new FreeCaseOpenFailedError();
    }
    return row;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const raced = await tx
      .select()
      .from(freeCaseUserState)
      .where(eq(freeCaseUserState.userId, userId))
      .for("update")
      .limit(1);
    const row = raced[0];
    if (!row) {
      throw new FreeCaseOpenFailedError();
    }
    return row;
  }
}

async function insertInbox(
  tx: GiftbotTx,
  input: {
    userId: string;
    title: string;
    body: string;
    openingId: string;
    itemCode: string;
  },
): Promise<void> {
  await tx.insert(notifications).values({
    userId: input.userId,
    channel: "inbox",
    type: "free_case_opened",
    status: "sent",
    title: input.title,
    body: input.body,
    sentAt: new Date(),
    payload: {
      openingId: input.openingId,
      caseCode: FREE_CASE_CODE,
      itemCode: input.itemCode,
    },
  });
}

function rewardBody(item: FreeCaseCatalogItem): string {
  if (item.rewardType === "azc") {
    return `Вы выиграли ${item.title}`;
  }
  if (item.rewardType === "gram") {
    return `Вы выиграли ${item.title}`;
  }
  return `Вы выиграли ${item.title.replace(/ NFT$/, "")}`;
}

export type FreeCaseOpenResult = {
  openingId: string;
  caseCode: typeof FREE_CASE_CODE;
  result: {
    itemCode: string;
    title: string;
    rarity: FreeCaseRarity;
    rewardType: FreeCaseRewardType;
    displayChance: string;
    realChance: string;
    imageKey: string;
  };
  nextAvailableAt: string;
  balances: { azc: string; gram: string };
  replayed: boolean;
};

function serializeOpeningResult(
  opening: typeof freeCaseOpenings.$inferSelect,
  balances: { azc: string; gram: string },
  replayed: boolean,
): FreeCaseOpenResult {
  const catalog = BY_CODE.get(opening.itemCode);
  return {
    openingId: opening.id,
    caseCode: FREE_CASE_CODE,
    result: {
      itemCode: opening.itemCode,
      title: opening.titleSnapshot,
      rarity: opening.rarity as FreeCaseRarity,
      rewardType: opening.rewardType as FreeCaseRewardType,
      displayChance: opening.displayChance,
      realChance: opening.realChance,
      imageKey: catalog?.imageKey ?? opening.itemCode,
    },
    nextAvailableAt: opening.nextAvailableAt.toISOString(),
    balances,
    replayed,
  };
}

export async function openFreeCase(
  db: GiftbotDb,
  input: {
    userId: string;
    idempotencyKey: string;
    clock?: Clock;
    /** Test-only: skip RNG and grant this catalog item. */
    forceItemCodeForTests?: string;
  },
): Promise<FreeCaseOpenResult> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  assertFreeCaseCatalogIntegrity();
  const clock = input.clock ?? systemClock;

  return db.transaction(async (tx) => {
    const state = await lockOrCreateUserState(tx, input.userId);

    const existing = await tx
      .select()
      .from(freeCaseOpenings)
      .where(
        and(
          eq(freeCaseOpenings.userId, input.userId),
          eq(freeCaseOpenings.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return serializeOpeningResult(
        existing[0],
        await readBalances(tx, input.userId),
        true,
      );
    }

    const now = clock.now();
    if (state.nextAvailableAt.getTime() > now.getTime()) {
      throw new FreeCaseCooldownActiveError(state.nextAvailableAt);
    }

    await ensureWallet(tx, input.userId);

    const openingId = randomUUID();
    const nextAvailableAt = new Date(now.getTime() + FREE_CASE_COOLDOWN_MS);

    let picked: FreeCaseCatalogItem;
    let drawId: string | undefined;
    if (input.forceItemCodeForTests) {
      const forced = BY_CODE.get(input.forceItemCodeForTests);
      if (!forced) {
        throw new FreeCaseOpenFailedError();
      }
      picked = forced;
    } else {
      const draw = await recordDraw(tx, {
        purpose: "case",
        maxExclusive: FREE_CASE_TOTAL_WEIGHT,
        referenceType: "free_case_opening",
        referenceId: openingId,
        unbiased: true,
      });
      drawId = draw.row.id;
      picked = pickWeightedByBigIntWeight(
        FREE_CASE_CATALOG.map((item) => ({ ...item, weight: item.weight })),
        draw.value,
      );
    }

    let walletTransactionId: string | undefined;
    let inventoryItemId: string | undefined;
    const rewardSnapshot: Record<string, string> = {
      rewardType: picked.rewardType,
      itemCode: picked.itemCode,
      weight: picked.weight.toString(),
    };

    if (picked.rewardType === "azc") {
      const amount = picked.rewardAmount;
      if (amount === null || amount <= 0n) {
        throw new FreeCaseOpenFailedError();
      }
      const paid = await applyIn(tx, {
        userId: input.userId,
        type: "free_case_reward",
        amountMinor: amount,
        idempotencyKey: `free_case:${openingId}:azc`,
        actorType: "system",
        referenceType: "free_case_opening",
        referenceId: openingId,
        metadata: {
          openingId,
          caseCode: FREE_CASE_CODE,
          itemCode: picked.itemCode,
          realWeight: picked.weight.toString(),
          realChance: picked.realChance,
        },
      });
      walletTransactionId = paid.transaction.id;
      rewardSnapshot.amountAzc = amount.toString();
    } else if (picked.rewardType === "gram") {
      const amount = picked.rewardAmount;
      if (amount === null || amount <= 0n) {
        throw new FreeCaseOpenFailedError();
      }
      await creditGramIn(tx, input.userId, amount);
      rewardSnapshot.amountGramMinor = amount.toString();
      rewardSnapshot.amountGram = formatGramMinor(amount);
    } else {
      const inserted = await tx
        .insert(inventoryItems)
        .values({
          userId: input.userId,
          itemType: "external_prize",
          status: "available",
          quantity: 1,
          amountRub: null,
          source: "free_case",
          itemCode: picked.itemCode,
          title: picked.title,
          metadata: {
            caseCode: FREE_CASE_CODE,
            openingId,
            rarity: picked.rarity,
            imageKey: picked.imageKey,
          },
        })
        .returning();
      const inv = inserted[0];
      if (!inv) {
        throw new FreeCaseOpenFailedError();
      }
      inventoryItemId = inv.id;
      rewardSnapshot.inventoryItemId = inv.id;
    }

    let opening: typeof freeCaseOpenings.$inferSelect;
    try {
      const created = await tx
        .insert(freeCaseOpenings)
        .values({
          id: openingId,
          userId: input.userId,
          caseCode: FREE_CASE_CODE,
          itemCode: picked.itemCode,
          titleSnapshot: picked.title,
          rarity: picked.rarity,
          rewardType: picked.rewardType,
          rewardSnapshot,
          realWeight: picked.weight,
          displayChance: picked.displayChance,
          realChance: picked.realChance,
          rngDrawId: drawId,
          openedAt: now,
          nextAvailableAt,
          idempotencyKey: input.idempotencyKey,
          walletTransactionId,
          inventoryItemId,
        })
        .returning();
      const row = created[0];
      if (!row) {
        throw new FreeCaseOpenFailedError();
      }
      opening = row;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await tx
        .select()
        .from(freeCaseOpenings)
        .where(
          and(
            eq(freeCaseOpenings.userId, input.userId),
            eq(freeCaseOpenings.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (raced[0]) {
        return serializeOpeningResult(
          raced[0],
          await readBalances(tx, input.userId),
          true,
        );
      }
      throw new ConflictError(
        "free case open raced",
        "FREE_CASE_NOT_AVAILABLE",
      );
    }

    await tx
      .update(freeCaseUserState)
      .set({
        nextAvailableAt,
        lastOpeningId: opening.id,
        updatedAt: now,
      })
      .where(eq(freeCaseUserState.userId, input.userId));

    await insertInbox(tx, {
      userId: input.userId,
      title: "Бесплатный кейс",
      body: rewardBody(picked),
      openingId: opening.id,
      itemCode: picked.itemCode,
    });

    const { evaluateAchievementsIn } = await import("./achievements.js");
    await evaluateAchievementsIn(tx, input.userId);

    return serializeOpeningResult(
      opening,
      await readBalances(tx, input.userId),
      false,
    );
  });
}

export type FreeCaseStatus = {
  caseCode: typeof FREE_CASE_CODE;
  available: boolean;
  nextAvailableAt: string | null;
  remainingSeconds: number;
  displayTotals: typeof FREE_CASE_DISPLAY_TOTALS;
  catalog: FreeCasePublicItem[];
  lastOpening: {
    openingId: string;
    itemCode: string;
    title: string;
    rarity: FreeCaseRarity;
    openedAt: string;
  } | null;
};

export async function getFreeCaseStatus(
  db: GiftbotDb,
  input: { userId: string; clock?: Clock },
): Promise<FreeCaseStatus> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const stateRows = await db
    .select()
    .from(freeCaseUserState)
    .where(eq(freeCaseUserState.userId, input.userId))
    .limit(1);
  const state = stateRows[0];
  const next = state?.nextAvailableAt ?? null;
  const available = !next || next.getTime() <= now.getTime();
  const remainingSeconds =
    available || !next
      ? 0
      : Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000));

  let lastOpening: FreeCaseStatus["lastOpening"] = null;
  if (state?.lastOpeningId) {
    const rows = await db
      .select()
      .from(freeCaseOpenings)
      .where(eq(freeCaseOpenings.id, state.lastOpeningId))
      .limit(1);
    const row = rows[0];
    if (row) {
      lastOpening = {
        openingId: row.id,
        itemCode: row.itemCode,
        title: row.titleSnapshot,
        rarity: row.rarity as FreeCaseRarity,
        openedAt: row.openedAt.toISOString(),
      };
    }
  }

  return {
    caseCode: FREE_CASE_CODE,
    available,
    nextAvailableAt: next ? next.toISOString() : null,
    remainingSeconds,
    displayTotals: FREE_CASE_DISPLAY_TOTALS,
    catalog: publicFreeCaseCatalog(),
    lastOpening,
  };
}

export type FreeCaseHistoryItem = {
  openingId: string;
  itemCode: string;
  title: string;
  rarity: FreeCaseRarity;
  rewardType: FreeCaseRewardType;
  openedAt: string;
};

export async function listFreeCaseHistory(
  db: GiftbotDb,
  input: { userId: string; limit?: number; cursor?: ProfileListCursor },
): Promise<{ items: FreeCaseHistoryItem[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const cursor = input.cursor;
  const cursorFilter = cursor
    ? or(
        lt(freeCaseOpenings.openedAt, new Date(cursor.createdAt)),
        and(
          eq(freeCaseOpenings.openedAt, new Date(cursor.createdAt)),
          lt(freeCaseOpenings.id, cursor.id),
        ),
      )
    : undefined;
  const rows = await db
    .select()
    .from(freeCaseOpenings)
    .where(
      cursorFilter
        ? and(eq(freeCaseOpenings.userId, input.userId), cursorFilter)
        : eq(freeCaseOpenings.userId, input.userId),
    )
    .orderBy(desc(freeCaseOpenings.openedAt), desc(freeCaseOpenings.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const extra = rows[limit];
  return {
    items: page.map((row) => ({
      openingId: row.id,
      itemCode: row.itemCode,
      title: row.titleSnapshot,
      rarity: row.rarity as FreeCaseRarity,
      rewardType: row.rewardType as FreeCaseRewardType,
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

export type RecentWinItem = {
  id: string;
  source:
    | "free_case"
    | "poor_case"
    | "medium_case"
    | "blatnoy_case"
    | "referral_case"
    | "mines"
    | "dice"
    | "rolls";
  username: string | null;
  displayName: string | null;
  publicId: string | null;
  avatarUrl?: string | null;
  title: string;
  rewardLabel: string;
  itemCode: string;
  rarity: FreeCaseRarity | null;
  /** Case catalog chance; Mines leaves null; Dice uses selected win chance; Rolls = locked stake/pot. */
  realChance: string | null;
  createdAt: string;
  caseCode?: string;
  /** Awarded payout AZC for game wins (cases omit). */
  payoutAzc?: string;
};

const RECENT_WINS_CACHE_TTL_MS = 8_000;
let recentWinsCache: { at: number; limit: number; items: RecentWinItem[] } | null =
  null;
let recentWinsInflight: Promise<{
  items: RecentWinItem[];
  limit: number;
}> | null = null;

export function invalidateRecentWinsCache(): void {
  recentWinsCache = null;
  recentWinsInflight = null;
}

export async function listRecentWins(
  db: GiftbotDb,
  input: { limit?: number } = {},
): Promise<{ items: RecentWinItem[]; serverTime: string }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const serverTime = new Date().toISOString();
  const now = Date.now();
  if (
    recentWinsCache &&
    now - recentWinsCache.at < RECENT_WINS_CACHE_TTL_MS &&
    recentWinsCache.limit >= limit
  ) {
    return {
      items: recentWinsCache.items.slice(0, limit),
      serverTime,
    };
  }

  if (!recentWinsInflight) {
    const fetchLimit = Math.max(limit, recentWinsCache?.limit ?? 0, 20);
    recentWinsInflight = loadRecentWinsUncached(db, fetchLimit).finally(() => {
      recentWinsInflight = null;
    });
  }
  const loaded = await recentWinsInflight;
  return {
    items: loaded.items.slice(0, limit),
    serverTime,
  };
}

async function loadRecentWinsUncached(
  db: GiftbotDb,
  limit: number,
): Promise<{ items: RecentWinItem[]; limit: number }> {
  const freeRows = await db
    .select({
      opening: freeCaseOpenings,
      publicId: users.publicId,
      displayName: users.displayName,
      username: telegramAccounts.username,
      photoUrl: telegramAccounts.photoUrl,
    })
    .from(freeCaseOpenings)
    .innerJoin(users, eq(users.id, freeCaseOpenings.userId))
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, freeCaseOpenings.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .orderBy(desc(freeCaseOpenings.openedAt), desc(freeCaseOpenings.id))
    .limit(limit);

  const freeItems: RecentWinItem[] = freeRows.map((row) => ({
    id: row.opening.id,
    source: "free_case" as const,
    username: row.username,
    displayName: row.displayName,
    publicId: row.publicId,
    avatarUrl: publicAvatarUrl(row.photoUrl),
    title: row.opening.titleSnapshot,
    rewardLabel: row.opening.titleSnapshot,
    itemCode: row.opening.itemCode,
    rarity: row.opening.rarity as FreeCaseRarity,
    realChance: row.opening.realChance,
    createdAt: row.opening.openedAt.toISOString(),
    caseCode: "free",
  }));

  const paidItems = (await listPaidRecentWins(db, { limit })).map((row) => ({
    id: row.id,
    source: row.source,
    username: row.username,
    displayName: row.displayName ?? null,
    publicId: row.publicId,
    avatarUrl: row.avatarUrl ?? null,
    title: row.title,
    rewardLabel: row.title,
    itemCode: row.itemCode,
    rarity: null,
    realChance: row.realChance,
    createdAt: row.createdAt,
    caseCode: row.caseCode,
  }));

  const referralItems = (await listReferralCaseRecentWins(db, { limit })).map(
    (row) => ({
      id: row.id,
      source: row.source,
      username: row.username,
      displayName: row.displayName ?? null,
      publicId: row.publicId,
      avatarUrl: row.avatarUrl ?? null,
      title: row.title,
      rewardLabel: row.title,
      itemCode: row.itemCode,
      rarity: null,
      realChance: row.realChance,
      createdAt: row.createdAt,
      caseCode: row.caseCode,
    }),
  );

  const { listMinesRecentWins } = await import("./mines.js");
  const { listDiceRecentWins } = await import("./dice.js");
  const { listRollsRecentWins } = await import("./rolls.js");
  const minesItems = (await listMinesRecentWins(db, { limit })).map((row) => ({
    id: row.id,
    source: "mines" as const,
    username: row.username,
    displayName: row.displayName ?? null,
    publicId: row.publicId,
    avatarUrl: row.avatarUrl ?? null,
    title: row.title,
    rewardLabel: row.title,
    itemCode: "mines_win",
    rarity: null,
    realChance: null,
    createdAt: row.createdAt,
    payoutAzc: row.payoutAzc,
  }));
  const diceItems = (await listDiceRecentWins(db, { limit })).map((row) => ({
    id: row.id,
    source: "dice" as const,
    username: row.username,
    displayName: row.displayName ?? null,
    publicId: row.publicId,
    avatarUrl: row.avatarUrl ?? null,
    title: row.title,
    rewardLabel: row.title,
    itemCode: "dice_win",
    rarity: null,
    realChance: String(row.chance),
    createdAt: row.createdAt,
    payoutAzc: row.payoutAzc,
  }));
  const rollsItems = (await listRollsRecentWins(db, { limit })).map((row) => ({
    id: row.id,
    source: "rolls" as const,
    username: row.username,
    displayName: row.displayName ?? null,
    publicId: row.publicId,
    avatarUrl: row.avatarUrl ?? null,
    title: row.title,
    rewardLabel: row.title,
    itemCode: "rolls_win",
    rarity: null,
    realChance: row.realChance,
    createdAt: row.createdAt,
    payoutAzc: row.payoutAzc,
  }));

  const merged = [
    ...freeItems,
    ...paidItems,
    ...referralItems,
    ...minesItems,
    ...diceItems,
    ...rollsItems,
  ].sort((a, b) => {
    const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (byTime !== 0) {
      return byTime;
    }
    return b.id.localeCompare(a.id);
  });

  const items = merged.slice(0, limit);
  recentWinsCache = { at: Date.now(), limit, items };
  return { items, limit };
}

/** Test helper: force nextAvailableAt without opening. */
export async function setFreeCaseNextAvailableAtForTests(
  db: GiftbotDb,
  userId: string,
  nextAvailableAt: Date,
): Promise<void> {
  await db
    .insert(freeCaseUserState)
    .values({ userId, nextAvailableAt })
    .onConflictDoUpdate({
      target: freeCaseUserState.userId,
      set: {
        nextAvailableAt,
        updatedAt: sql`now()`,
      },
    });
}
