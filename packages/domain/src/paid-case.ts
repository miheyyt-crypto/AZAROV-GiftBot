import {
  inventoryItems,
  notifications,
  paidCaseOpenings,
  telegramAccounts,
  users,
  wallets,
} from "@giftbot/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  CaseInsufficientBalanceError,
  CaseNotFoundError,
  ConflictError,
  InsufficientFundsError,
  PaidCaseOpenFailedError,
} from "./errors.js";
import { asBigInt } from "./money.js";
import { publicAvatarUrl } from "./https-url.js";
import {
  clampProfileListLimit,
  encodeProfileCursor,
  type ProfileListCursor,
} from "./profile-read.js";
import { pickWeightedByBigIntWeight, recordDraw } from "./rng.js";
import { applyIn } from "./wallet.js";

/** Exact scale: 100_000_000 ≡ 100.000% so 0.001% = 1_000 weight units. */
export const PAID_CASE_TOTAL_WEIGHT = 100_000_000n;

export type PaidCaseCode = "poor" | "medium" | "blatnoy";
export type PaidCaseRewardType = "azc" | "cash_rub";

export type PaidCaseCatalogItem = {
  itemCode: string;
  title: string;
  rewardType: PaidCaseRewardType;
  /** AZC minor or ₽ whole units depending on rewardType. */
  rewardAmount: bigint;
  weight: bigint;
  realChance: string;
  /** Product-facing display odds — not decided for paid cases yet. */
  displayChance: string | null;
  imageKey: string;
};

export type PaidCaseDefinition = {
  code: PaidCaseCode;
  title: string;
  priceAzc: bigint;
  cashSource: "poor_case" | "medium_case" | "blatnoy_case";
  items: readonly PaidCaseCatalogItem[];
};

export const PAID_CASE_CATALOG: readonly PaidCaseDefinition[] = [
  {
    code: "poor",
    title: "Нищий",
    priceAzc: 8_999n,
    cashSource: "poor_case",
    items: [
      {
        itemCode: "poor-cash-5000",
        title: "5 000 ₽",
        rewardType: "cash_rub",
        rewardAmount: 5_000n,
        weight: 1_000n,
        realChance: "0.001",
        displayChance: null,
        imageKey: "poor-cash-5000",
      },
      {
        itemCode: "poor-cash-1000",
        title: "1 000 ₽",
        rewardType: "cash_rub",
        rewardAmount: 1_000n,
        weight: 1_000n,
        realChance: "0.001",
        displayChance: null,
        imageKey: "poor-cash-1000",
      },
      {
        itemCode: "poor-azc-12000",
        title: "12 000 AZC",
        rewardType: "azc",
        rewardAmount: 12_000n,
        weight: 7_000_000n,
        realChance: "7",
        displayChance: null,
        imageKey: "poor-azc-12000",
      },
      {
        itemCode: "poor-azc-7777",
        title: "7 777 AZC",
        rewardType: "azc",
        rewardAmount: 7_777n,
        weight: 10_000_000n,
        realChance: "10",
        displayChance: null,
        imageKey: "poor-azc-7777",
      },
      {
        itemCode: "poor-azc-5000",
        title: "5 000 AZC",
        rewardType: "azc",
        rewardAmount: 5_000n,
        weight: 20_000_000n,
        realChance: "20",
        displayChance: null,
        imageKey: "poor-azc-5000",
      },
      {
        itemCode: "poor-azc-3333",
        title: "3 333 AZC",
        rewardType: "azc",
        rewardAmount: 3_333n,
        weight: 62_998_000n,
        realChance: "62.998",
        displayChance: null,
        imageKey: "poor-azc-3333",
      },
    ],
  },
  {
    code: "medium",
    title: "Средний",
    priceAzc: 22_222n,
    cashSource: "medium_case",
    items: [
      {
        itemCode: "medium-cash-10000",
        title: "10 000 ₽",
        rewardType: "cash_rub",
        rewardAmount: 10_000n,
        weight: 1_000n,
        realChance: "0.001",
        displayChance: null,
        imageKey: "medium-cash-10000",
      },
      {
        itemCode: "medium-cash-5000",
        title: "5 000 ₽",
        rewardType: "cash_rub",
        rewardAmount: 5_000n,
        weight: 1_000n,
        realChance: "0.001",
        displayChance: null,
        imageKey: "medium-cash-5000",
      },
      {
        itemCode: "medium-cash-1000",
        title: "1 000 ₽",
        rewardType: "cash_rub",
        rewardAmount: 1_000n,
        weight: 100_000n,
        realChance: "0.1",
        displayChance: null,
        imageKey: "medium-cash-1000",
      },
      {
        itemCode: "medium-azc-20000",
        title: "20 000 AZC",
        rewardType: "azc",
        rewardAmount: 20_000n,
        weight: 11_000_000n,
        realChance: "11",
        displayChance: null,
        imageKey: "medium-azc-20000",
      },
      {
        itemCode: "medium-azc-11111",
        title: "11 111 AZC",
        rewardType: "azc",
        rewardAmount: 11_111n,
        weight: 28_000_000n,
        realChance: "28",
        displayChance: null,
        imageKey: "medium-azc-11111",
      },
      {
        itemCode: "medium-azc-8888",
        title: "8 888 AZC",
        rewardType: "azc",
        rewardAmount: 8_888n,
        weight: 60_898_000n,
        realChance: "60.898",
        displayChance: null,
        imageKey: "medium-azc-8888",
      },
    ],
  },
  {
    code: "blatnoy",
    title: "Блатной",
    priceAzc: 64_999n,
    cashSource: "blatnoy_case",
    items: [
      {
        itemCode: "blatnoy-cash-30000",
        title: "30 000 ₽",
        rewardType: "cash_rub",
        rewardAmount: 30_000n,
        weight: 1_000n,
        realChance: "0.001",
        displayChance: null,
        imageKey: "blatnoy-cash-30000",
      },
      {
        itemCode: "blatnoy-cash-10000",
        title: "10 000 ₽",
        rewardType: "cash_rub",
        rewardAmount: 10_000n,
        weight: 1_000n,
        realChance: "0.001",
        displayChance: null,
        imageKey: "blatnoy-cash-10000",
      },
      {
        itemCode: "blatnoy-cash-5000",
        title: "5 000 ₽",
        rewardType: "cash_rub",
        rewardAmount: 5_000n,
        weight: 1_000_000n,
        realChance: "1",
        displayChance: null,
        imageKey: "blatnoy-cash-5000",
      },
      {
        itemCode: "blatnoy-cash-2000",
        title: "2 000 ₽",
        rewardType: "cash_rub",
        rewardAmount: 2_000n,
        weight: 1_000_000n,
        realChance: "1",
        displayChance: null,
        imageKey: "blatnoy-cash-2000",
      },
      {
        itemCode: "blatnoy-azc-44444",
        title: "44 444 AZC",
        rewardType: "azc",
        rewardAmount: 44_444n,
        weight: 35_000_000n,
        realChance: "35",
        displayChance: null,
        imageKey: "blatnoy-azc-44444",
      },
      {
        itemCode: "blatnoy-azc-22222",
        title: "22 222 AZC",
        rewardType: "azc",
        rewardAmount: 22_222n,
        weight: 62_998_000n,
        realChance: "62.998",
        displayChance: null,
        imageKey: "blatnoy-azc-22222",
      },
    ],
  },
] as const;

const BY_CODE = new Map(
  PAID_CASE_CATALOG.map((row) => [row.code, row] as const),
);

export function isPaidCaseCode(value: string): value is PaidCaseCode {
  return value === "poor" || value === "medium" || value === "blatnoy";
}

export function getPaidCase(code: string): PaidCaseDefinition {
  if (!isPaidCaseCode(code)) {
    throw new CaseNotFoundError();
  }
  const found = BY_CODE.get(code);
  if (!found) {
    throw new CaseNotFoundError();
  }
  return found;
}

export function paidCaseCatalogTotalWeight(
  items: readonly PaidCaseCatalogItem[],
): bigint {
  return items.reduce((sum, item) => sum + item.weight, 0n);
}

export function assertPaidCaseCatalogIntegrity(): void {
  for (const paidCase of PAID_CASE_CATALOG) {
    if (paidCase.priceAzc <= 0n) {
      throw new Error(`${paidCase.code}: price must be positive`);
    }
    const total = paidCaseCatalogTotalWeight(paidCase.items);
    if (total !== PAID_CASE_TOTAL_WEIGHT) {
      throw new Error(
        `${paidCase.code}: weight sum ${total} !== ${PAID_CASE_TOTAL_WEIGHT}`,
      );
    }
    for (const item of paidCase.items) {
      if (item.weight <= 0n) {
        throw new Error(`${paidCase.code}/${item.itemCode}: weight`);
      }
      if (item.rewardAmount <= 0n) {
        throw new Error(`${paidCase.code}/${item.itemCode}: reward`);
      }
      if (item.displayChance !== null) {
        throw new Error(
          `${paidCase.code}/${item.itemCode}: displayChance must stay null`,
        );
      }
    }
  }
}

export type PaidCasePublicItem = {
  itemCode: string;
  title: string;
  rewardType: PaidCaseRewardType;
  rewardAmount: string;
  realChance: string;
  displayChance: string | null;
  imageKey: string;
};

export type PaidCasePublicCatalog = {
  code: PaidCaseCode;
  title: string;
  priceAzc: string;
  items: PaidCasePublicItem[];
};

export function listPaidCaseCatalog(): PaidCasePublicCatalog[] {
  assertPaidCaseCatalogIntegrity();
  return PAID_CASE_CATALOG.map((paidCase) => ({
    code: paidCase.code,
    title: paidCase.title,
    priceAzc: paidCase.priceAzc.toString(),
    items: paidCase.items.map((item) => ({
      itemCode: item.itemCode,
      title: item.title,
      rewardType: item.rewardType,
      rewardAmount: item.rewardAmount.toString(),
      realChance: item.realChance,
      displayChance: item.displayChance,
      imageKey: item.imageKey,
    })),
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

async function readAzcBalance(tx: GiftbotTx, userId: string): Promise<string> {
  const rows = await tx
    .select({ balanceMinor: wallets.balanceMinor })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return asBigInt(rows[0]?.balanceMinor ?? 0n).toString();
}

function notificationCopy(
  paidCase: PaidCaseDefinition,
  item: PaidCaseCatalogItem,
): { title: string; body: string } {
  if (item.rewardType === "azc") {
    return {
      title: `Вы выиграли ${item.title}`,
      body: `Кейс «${paidCase.title}»`,
    };
  }
  return {
    title: `Вы выиграли ${item.title}`,
    body: "Приз добавлен в инвентарь",
  };
}

export type PaidCaseOpenResult = {
  openingId: string;
  caseCode: PaidCaseCode;
  priceAzc: string;
  result: {
    itemCode: string;
    title: string;
    rewardType: PaidCaseRewardType;
    rewardAmount?: string;
    rewardAmountRub?: string;
    inventoryItemId?: string;
    realChance: string;
    displayChance: string | null;
    imageKey: string;
  };
  balances: { azc: string };
  replayed: boolean;
};

function serializeOpening(
  opening: typeof paidCaseOpenings.$inferSelect,
  balances: { azc: string },
  replayed: boolean,
): PaidCaseOpenResult {
  const paidCase = getPaidCase(opening.caseCode);
  const catalog = paidCase.items.find((row) => row.itemCode === opening.itemCode);
  const snapshot =
    typeof opening.rewardSnapshot === "object" && opening.rewardSnapshot !== null
      ? (opening.rewardSnapshot as Record<string, unknown>)
      : {};
  const base = {
    openingId: opening.id,
    caseCode: opening.caseCode as PaidCaseCode,
    priceAzc: asBigInt(opening.priceAzc).toString(),
    result: {
      itemCode: opening.itemCode,
      title: opening.titleSnapshot,
      rewardType: opening.rewardType as PaidCaseRewardType,
      realChance: opening.realChance,
      displayChance: opening.displayChance,
      imageKey: catalog?.imageKey ?? opening.itemCode,
    },
    balances,
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

export async function openPaidCase(
  db: GiftbotDb,
  input: {
    userId: string;
    caseCode: string;
    idempotencyKey: string;
    clock?: Clock;
    /** Test-only: skip RNG and grant this catalog item. */
    forceItemCodeForTests?: string;
    /** Test-only: throw after price debit to prove rollback. */
    failAfterDebitForTests?: boolean;
  },
): Promise<PaidCaseOpenResult> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  assertPaidCaseCatalogIntegrity();
  const paidCase = getPaidCase(input.caseCode);
  const clock = input.clock ?? systemClock;

  return db.transaction(async (tx) => {
    // Serialize same user+idempotencyKey so concurrent replays share one opening
    // without aborting the loser transaction on unique_violation (25P02).
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`paid-case:${input.userId}:${input.idempotencyKey}`}))`,
    );

    const existing = await tx
      .select()
      .from(paidCaseOpenings)
      .where(
        and(
          eq(paidCaseOpenings.userId, input.userId),
          eq(paidCaseOpenings.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return serializeOpening(
        existing[0],
        { azc: await readAzcBalance(tx, input.userId) },
        true,
      );
    }

    await ensureWallet(tx, input.userId);
    const openingId = randomUUID();
    const now = clock.now();

    let purchaseTxId: string;
    try {
      const purchase = await applyIn(tx, {
        userId: input.userId,
        type: "paid_case_purchase",
        amountMinor: -paidCase.priceAzc,
        idempotencyKey: `paid_case:${openingId}:purchase`,
        actorType: "user",
        actorId: input.userId,
        reason: `Открытие кейса «${paidCase.title}»`,
        referenceType: "paid_case_opening",
        referenceId: openingId,
        metadata: {
          openingId,
          caseCode: paidCase.code,
          priceAzc: paidCase.priceAzc.toString(),
        },
      });
      purchaseTxId = purchase.transaction.id;
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new CaseInsufficientBalanceError();
      }
      throw error;
    }

    if (input.failAfterDebitForTests) {
      throw new PaidCaseOpenFailedError();
    }

    let picked: PaidCaseCatalogItem;
    let drawId: string | undefined;
    if (input.forceItemCodeForTests) {
      const forced = paidCase.items.find(
        (item) => item.itemCode === input.forceItemCodeForTests,
      );
      if (!forced) {
        throw new PaidCaseOpenFailedError();
      }
      picked = forced;
    } else {
      const { row: draw, value } = await recordDraw(tx, {
        purpose: "case",
        maxExclusive: PAID_CASE_TOTAL_WEIGHT,
        referenceType: "paid_case_opening",
        referenceId: openingId,
        unbiased: true,
      });
      drawId = draw.id;
      picked = pickWeightedByBigIntWeight(paidCase.items, value);
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
        type: "paid_case_reward",
        amountMinor: picked.rewardAmount,
        idempotencyKey: `paid_case:${openingId}:reward`,
        actorType: "system",
        reason: `Выигрыш из кейса «${paidCase.title}»`,
        referenceType: "paid_case_opening",
        referenceId: openingId,
        metadata: {
          openingId,
          caseCode: paidCase.code,
          itemCode: picked.itemCode,
          realWeight: picked.weight.toString(),
          realChance: picked.realChance,
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
          source: paidCase.cashSource,
          itemCode: picked.itemCode,
          title: picked.title,
          metadata: {
            caseCode: paidCase.code,
            openingId,
            imageKey: picked.imageKey,
          },
        })
        .returning();
      const inv = inserted[0];
      if (!inv) {
        throw new PaidCaseOpenFailedError();
      }
      inventoryItemId = inv.id;
      rewardSnapshot.amountRub = picked.rewardAmount.toString();
      rewardSnapshot.inventoryItemId = inv.id;
    }

    let opening: typeof paidCaseOpenings.$inferSelect;
    try {
      const created = await tx
        .insert(paidCaseOpenings)
        .values({
          id: openingId,
          userId: input.userId,
          caseCode: paidCase.code,
          priceAzc: paidCase.priceAzc,
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
          purchaseTransactionId: purchaseTxId,
          rewardTransactionId,
          inventoryItemId,
        })
        .returning();
      const row = created[0];
      if (!row) {
        throw new PaidCaseOpenFailedError();
      }
      opening = row;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await tx
        .select()
        .from(paidCaseOpenings)
        .where(
          and(
            eq(paidCaseOpenings.userId, input.userId),
            eq(paidCaseOpenings.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (raced[0]) {
        return serializeOpening(
          raced[0],
          { azc: await readAzcBalance(tx, input.userId) },
          true,
        );
      }
      throw new ConflictError("paid case open raced", "CASE_OPEN_CONFLICT");
    }

    const copy = notificationCopy(paidCase, picked);
    await tx.insert(notifications).values({
      userId: input.userId,
      channel: "inbox",
      type: "paid_case_opened",
      status: "sent",
      title: copy.title,
      body: copy.body,
      sentAt: now,
      payload: {
        openingId: opening.id,
        caseCode: paidCase.code,
        itemCode: picked.itemCode,
        rewardType: picked.rewardType,
      },
    });

    const { evaluateAchievementsIn } = await import("./achievements.js");
    await evaluateAchievementsIn(tx, input.userId);

    return serializeOpening(
      opening,
      { azc: await readAzcBalance(tx, input.userId) },
      false,
    );
  });
}

export type PaidCaseHistoryItem = {
  openingId: string;
  caseCode: PaidCaseCode;
  priceAzc: string;
  itemCode: string;
  title: string;
  rewardType: PaidCaseRewardType;
  realChance: string;
  openedAt: string;
};

export async function listPaidCaseHistory(
  db: GiftbotDb,
  input: {
    userId: string;
    caseCode?: PaidCaseCode;
    limit?: number;
    cursor?: ProfileListCursor;
  },
): Promise<{ items: PaidCaseHistoryItem[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const filters = [eq(paidCaseOpenings.userId, input.userId)];
  if (input.caseCode) {
    filters.push(eq(paidCaseOpenings.caseCode, input.caseCode));
  }
  if (input.cursor) {
    filters.push(
      sql`(${paidCaseOpenings.openedAt}, ${paidCaseOpenings.id}) < (${new Date(input.cursor.createdAt)}::timestamptz, ${input.cursor.id}::uuid)`,
    );
  }
  const rows = await db
    .select()
    .from(paidCaseOpenings)
    .where(and(...filters))
    .orderBy(desc(paidCaseOpenings.openedAt), desc(paidCaseOpenings.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const extra = rows[limit];
  return {
    items: page.map((row) => ({
      openingId: row.id,
      caseCode: row.caseCode as PaidCaseCode,
      priceAzc: asBigInt(row.priceAzc).toString(),
      itemCode: row.itemCode,
      title: row.titleSnapshot,
      rewardType: row.rewardType as PaidCaseRewardType,
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

export type RecentWinSource =
  | "free_case"
  | "poor_case"
  | "medium_case"
  | "blatnoy_case";

function sourceForPaidCode(code: string): RecentWinSource {
  if (code === "poor") return "poor_case";
  if (code === "medium") return "medium_case";
  if (code === "blatnoy") return "blatnoy_case";
  return "poor_case";
}

export async function listPaidRecentWins(
  db: GiftbotDb,
  input: { limit?: number } = {},
): Promise<
  {
    id: string;
    source: RecentWinSource;
    username: string | null;
    displayName: string | null;
    publicId: string | null;
    avatarUrl: string | null;
    title: string;
    itemCode: string;
    caseCode: string;
    realChance: string;
    createdAt: string;
  }[]
> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const rows = await db
    .select({
      opening: paidCaseOpenings,
      publicId: users.publicId,
      displayName: users.displayName,
      username: telegramAccounts.username,
      photoUrl: telegramAccounts.photoUrl,
    })
    .from(paidCaseOpenings)
    .innerJoin(users, eq(users.id, paidCaseOpenings.userId))
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, paidCaseOpenings.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .orderBy(desc(paidCaseOpenings.openedAt), desc(paidCaseOpenings.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.opening.id,
    source: sourceForPaidCode(row.opening.caseCode),
    username: row.username,
    displayName: row.displayName,
    publicId: row.publicId,
    avatarUrl: publicAvatarUrl(row.photoUrl),
    title: row.opening.titleSnapshot,
    itemCode: row.opening.itemCode,
    caseCode: row.opening.caseCode,
    realChance: row.opening.realChance,
    createdAt: row.opening.openedAt.toISOString(),
  }));
}
