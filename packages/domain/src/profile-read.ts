import {
  gramBalances,
  inventoryItems,
  kickAccounts,
  notifications,
  products,
  purchases,
  telegramAccounts,
  userKickStats,
  userProgress,
  users,
  walletTransactions,
  wallets,
  welvuraLinks,
} from "@giftbot/db/schema";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { GiftbotDb } from "./db.js";
import { loadActiveCashWithdrawalsByItemIds } from "./cash-withdrawal.js";
import { NotFoundError } from "./errors.js";
import { serializeGramSummary } from "./gram.js";
import { publicAvatarUrl } from "./https-url.js";
import { computeLevel, serializeLevel } from "./level.js";
import { asBigInt } from "./money.js";

export const PROFILE_LIST_DEFAULT_LIMIT = 20;
export const PROFILE_LIST_MAX_LIMIT = 50;

export type WelvuraReadStatus = "not_linked" | "pending" | "approved" | "rejected";
export type OrderReadStatus = "pending" | "processing" | "fulfilled" | "rejected";
export type InventoryCashStatus = "available" | "reserved" | "consumed";

export type ProfileListCursor = {
  createdAt: string;
  id: string;
};

const ORDER_STATUS_FROM_PURCHASE = {
  created: "pending",
  paid: "processing",
  delivered: "fulfilled",
  failed: "rejected",
  refunded: "rejected",
} as const satisfies Record<string, OrderReadStatus>;

const LEDGER_LABELS: Record<string, string> = {
  deposit: "Пополнение",
  bet: "Ставка",
  prize: "Выигрыш",
  admin_adjustment: "Корректировка баланса",
  reversal: "Отмена операции",
  referral_reward: "Реферальная награда",
  referral_inviter_reward: "Реферальная награда",
  referral_referred_reward: "Бонус за приглашение",
  referral_manual_credit: "Ручное реферальное начисление",
  referral_case_reward: "Выигрыш из реферального кейса",
  task_reward: "Награда за задание",
  welvura_deposit_reward: "Welvura — награда",
  level_reward: "Награда за уровень",
  stream_streak_reward: "Награда за серию стримов",
  mines_bet: "Mines — ставка",
  mines_win: "Mines — выигрыш",
  dice_bet: "Dice — ставка",
  dice_win: "Dice — выигрыш",
  rolls_bet: "Rolls — ставка",
  rolls_win: "Rolls — выигрыш",
  giveaway_reward: "Победа в розыгрыше",
  referral_contest_reward: "Реферальный баттл",
  purchase: "Покупка в магазине",
  refund: "Возврат заказа",
  reward: "Награда за задание",
  promo_code_reward: "Промокод",
  shop_purchase: "Покупка в магазине",
  stream_donation: "Донат на стрим",
  shop_refund: "Возврат заказа",
  free_case_reward: "Выигрыш из бесплатного кейса",
  paid_case_purchase: "Открытие кейса",
  paid_case_reward: "Выигрыш из кейса",
  achievement_reward: "Достижение",
};

const SUBMITTED_PREVIEW_KEYS = [
  "welvuraId",
  "slotName",
  "telegramUsername",
  "kickUsername",
  "streamNickname",
  "displayNickname",
  "donationText",
  "mediaUrl",
] as const;

export function encodeProfileCursor(cursor: ProfileListCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeProfileCursor(raw: string | undefined): ProfileListCursor | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const splitAt = decoded.lastIndexOf("|");
    if (splitAt <= 0) {
      return undefined;
    }
    const createdAt = decoded.slice(0, splitAt);
    const id = decoded.slice(splitAt + 1);
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
      return undefined;
    }
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

export function clampProfileListLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) {
    return PROFILE_LIST_DEFAULT_LIMIT;
  }
  return Math.min(PROFILE_LIST_MAX_LIMIT, Math.max(1, Math.trunc(raw)));
}

function payloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeSubmittedPreview(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const row = payload as Record<string, unknown>;
  const preview: Record<string, string> = {};
  for (const key of SUBMITTED_PREVIEW_KEYS) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) {
      preview[key] = value;
    }
  }
  return preview;
}

function ledgerLabel(type: string): string {
  return LEDGER_LABELS[type] ?? type;
}

function ledgerLabelForRow(
  type: string,
  reason: string | null,
  metadata: unknown,
): string {
  if (type === "level_reward") {
    const meta =
      typeof metadata === "object" && metadata !== null
        ? (metadata as Record<string, unknown>)
        : undefined;
    const level = meta?.reachedLevel;
    if (typeof level === "number") {
      return `Награда за ${level} уровень`;
    }
  }
  if (type === "stream_streak_reward") {
    return "Награда за серию стримов";
  }
  if (type === "achievement_reward") {
    if (reason && reason.trim().length > 0) {
      return reason;
    }
    const meta =
      typeof metadata === "object" && metadata !== null
        ? (metadata as Record<string, unknown>)
        : undefined;
    const code = meta?.achievementCode;
    if (typeof code === "string") {
      const titles: Record<string, string> = {
        kick_100_messages: "Первые шаги",
        referrals_5_active: "Своя компания",
        games_100_total: "Игрок",
        cases_25_opened: "Любитель кейсов",
        level_10: "Преданный зритель",
      };
      const title = titles[code];
      if (title) {
        return `Достижение: ${title}`;
      }
    }
    return "Достижение";
  }
  if (Object.prototype.hasOwnProperty.call(LEDGER_LABELS, type)) {
    return ledgerLabel(type);
  }
  if (reason && reason.trim().length > 0) {
    return reason;
  }
  return ledgerLabel(type);
}

function olderThanCursor(
  createdAtCol: unknown,
  idCol: unknown,
  cursor: ProfileListCursor | undefined,
) {
  if (!cursor) {
    return undefined;
  }
  const created = createdAtCol as typeof walletTransactions.createdAt;
  const id = idCol as typeof walletTransactions.id;
  const cursorDate = new Date(cursor.createdAt);
  return or(
    lt(created, cursorDate),
    and(eq(created, cursorDate), lt(id, cursor.id)),
  );
}

export async function readProfileSummary(db: GiftbotDb, userId: string) {
  const [
    userRows,
    telegramRows,
    walletRows,
    gramRows,
    progressRows,
    kickRows,
    kickStatRows,
    welvuraRows,
    unreadRows,
    inventoryRows,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    db
      .select()
      .from(telegramAccounts)
      .where(and(eq(telegramAccounts.userId, userId), eq(telegramAccounts.isActive, true)))
      .limit(1),
    db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1),
    db.select().from(gramBalances).where(eq(gramBalances.userId, userId)).limit(1),
    db.select().from(userProgress).where(eq(userProgress.userId, userId)).limit(1),
    db
      .select({
        username: kickAccounts.username,
        displayName: kickAccounts.displayName,
        avatarUrl: kickAccounts.avatarUrl,
      })
      .from(kickAccounts)
      .where(and(eq(kickAccounts.userId, userId), eq(kickAccounts.status, "active")))
      .limit(1),
    db.select().from(userKickStats).where(eq(userKickStats.userId, userId)).limit(1),
    db.select().from(welvuraLinks).where(eq(welvuraLinks.userId, userId)).limit(1),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.channel, "inbox"),
          sql`${notifications.readAt} is null`,
        ),
      ),
    db
      .select({
        itemType: inventoryItems.itemType,
        quantity: inventoryItems.quantity,
      })
      .from(inventoryItems)
      .where(
        and(eq(inventoryItems.userId, userId), eq(inventoryItems.status, "available")),
      ),
  ]);

  const user = userRows[0];
  const wallet = walletRows[0];
  if (!user || !wallet) {
    throw new NotFoundError("profile not found");
  }

  const telegram = telegramRows[0];
  const displayParts = [telegram?.firstName, telegram?.lastName].filter(
    (part): part is string => Boolean(part),
  );
  const kick = kickRows[0];
  const welvura = welvuraRows[0];
  const welvuraStatus: WelvuraReadStatus = welvura ? welvura.status : "not_linked";
  const totalXp = asBigInt(progressRows[0]?.totalXp ?? 0n);
  const level = serializeLevel(computeLevel(totalXp));
  const gram = serializeGramSummary(
    asBigInt(gramRows[0]?.amountMinor ?? 0n),
    asBigInt(gramRows[0]?.reservedMinor ?? 0n),
  );
  const kickMessages = asBigInt(kickStatRows[0]?.chatMessagesCounted ?? 0n);

  let itemCount = 0;
  let streakFreezeCount = 0;
  for (const item of inventoryRows) {
    if (item.itemType === "streak_freeze") {
      streakFreezeCount += item.quantity;
      itemCount += item.quantity;
    } else {
      itemCount += item.quantity;
    }
  }

  return {
    user: {
      id: user.publicId,
      telegramUsername: telegram?.username ?? null,
      telegramFirstName: telegram?.firstName ?? null,
      telegramLastName: telegram?.lastName ?? null,
      displayName: (user.displayName ?? displayParts.join(" ")) || null,
      avatarUrl: publicAvatarUrl(telegram?.photoUrl),
    },
    balances: {
      azc: asBigInt(wallet.balanceMinor).toString(),
      gram: gram.available,
    },
    gram,
    level,
    activity: {
      kickChatMessages: kickMessages.toString(),
    },
    integrations: {
      kick: {
        linked: Boolean(kick),
        username: kick?.username ?? null,
        displayName: kick?.displayName ?? null,
        avatarUrl: publicAvatarUrl(kick?.avatarUrl),
      },
      welvura: {
        status: welvuraStatus,
        id: welvura?.welvuraExternalId ?? null,
      },
    },
    notifications: {
      unreadCount: Number(unreadRows[0]?.value ?? 0),
    },
    inventory: {
      itemCount,
      streakFreezeCount,
    },
  };
}

export async function readProfileNotifications(
  db: GiftbotDb,
  input: { userId: string; cursor?: ProfileListCursor; limit?: number },
) {
  const limit = clampProfileListLimit(input.limit);
  const cursorFilter = olderThanCursor(
    notifications.createdAt,
    notifications.id,
    input.cursor,
  );
  const rows = await db
    .select()
    .from(notifications)
    .where(
      cursorFilter
        ? and(
            eq(notifications.userId, input.userId),
            eq(notifications.channel, "inbox"),
            cursorFilter,
          )
        : and(eq(notifications.userId, input.userId), eq(notifications.channel, "inbox")),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title ?? payloadString(row.payload, "title") ?? row.type,
      body: row.body ?? payloadString(row.payload, "body") ?? "",
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt ? row.readAt.toISOString() : null,
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeProfileCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function readProfileLedger(
  db: GiftbotDb,
  input: { userId: string; cursor?: ProfileListCursor; limit?: number },
) {
  const limit = clampProfileListLimit(input.limit);
  const cursorFilter = olderThanCursor(
    walletTransactions.createdAt,
    walletTransactions.id,
    input.cursor,
  );
  const rows = await db
    .select()
    .from(walletTransactions)
    .where(
      cursorFilter
        ? and(eq(walletTransactions.userId, input.userId), cursorFilter)
        : eq(walletTransactions.userId, input.userId),
    )
    .orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row.id,
      type: row.type,
      label: ledgerLabelForRow(row.type, row.reason, row.metadata),
      delta: asBigInt(row.amountMinor).toString(),
      balanceAfter: asBigInt(row.balanceAfterMinor).toString(),
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeProfileCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function readProfileInventory(
  db: GiftbotDb,
  input: { userId: string; cursor?: ProfileListCursor; limit?: number },
) {
  const limit = clampProfileListLimit(input.limit);
  const cursorFilter = olderThanCursor(
    inventoryItems.createdAt,
    inventoryItems.id,
    input.cursor,
  );
  const rows = await db
    .select()
    .from(inventoryItems)
    .where(
      cursorFilter
        ? and(eq(inventoryItems.userId, input.userId), cursorFilter)
        : eq(inventoryItems.userId, input.userId),
    )
    .orderBy(desc(inventoryItems.createdAt), desc(inventoryItems.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const cashItemIds = page
    .filter((row) => row.itemType === "cash_rub")
    .map((row) => row.id);
  const activeByItem = await loadActiveCashWithdrawalsByItemIds(
    db,
    input.userId,
    cashItemIds,
  );
  return {
    items: page.map((row) => {
      if (row.itemType === "streak_freeze") {
        return {
          type: "streak_freeze" as const,
          id: row.id,
          quantity: row.quantity,
          status: row.status as InventoryCashStatus,
        };
      }
      if (row.itemType === "external_prize") {
        return {
          type: "external_prize" as const,
          id: row.id,
          itemCode: row.itemCode ?? "",
          title: row.title ?? row.itemCode ?? "Приз",
          source: row.source ?? "",
          status: row.status as InventoryCashStatus,
        };
      }
      const active = activeByItem.get(row.id) ?? null;
      return {
        type: "cash_rub" as const,
        id: row.id,
        amountRub: asBigInt(row.amountRub ?? 0n).toString(),
        source: row.source ?? "",
        status: row.status as InventoryCashStatus,
        activeWithdrawal: active,
      };
    }),
    nextCursor:
      rows.length > limit && last
        ? encodeProfileCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

export async function readProfileOrders(
  db: GiftbotDb,
  input: {
    userId: string;
    cursor?: ProfileListCursor;
    limit?: number;
    status?: OrderReadStatus;
  },
) {
  const limit = clampProfileListLimit(input.limit);
  const cursorFilter = olderThanCursor(
    purchases.createdAt,
    purchases.id,
    input.cursor,
  );
  const purchaseStatuses = input.status
    ? (Object.entries(ORDER_STATUS_FROM_PURCHASE) as Array<
        [keyof typeof ORDER_STATUS_FROM_PURCHASE, OrderReadStatus]
      >)
        .filter(([, mapped]) => mapped === input.status)
        .map(([status]) => status)
    : undefined;

  const rows = await db
    .select({
      id: purchases.id,
      status: purchases.status,
      priceMinor: purchases.priceMinor,
      createdAt: purchases.createdAt,
      updatedAt: purchases.updatedAt,
      rejectionReason: purchases.rejectionReason,
      submittedPayload: purchases.submittedPayload,
      productCodeSnapshot: purchases.productCode,
      productNameSnapshot: purchases.productNameSnapshot,
      productSlug: products.slug,
      productPayload: products.payload,
    })
    .from(purchases)
    .innerJoin(products, eq(purchases.productId, products.id))
    .where(
      and(
        eq(purchases.userId, input.userId),
        ...(cursorFilter ? [cursorFilter] : []),
        ...(purchaseStatuses && purchaseStatuses.length > 0
          ? [inArray(purchases.status, purchaseStatuses)]
          : []),
      ),
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row.id,
      productCode: row.productCodeSnapshot ?? row.productSlug,
      productName:
        row.productNameSnapshot ??
        payloadString(row.productPayload, "title") ??
        row.productSlug,
      priceAzc: asBigInt(row.priceMinor).toString(),
      status: ORDER_STATUS_FROM_PURCHASE[row.status],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      rejectionReason: row.rejectionReason,
      submittedPreview: safeSubmittedPreview(row.submittedPayload),
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeProfileCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}
