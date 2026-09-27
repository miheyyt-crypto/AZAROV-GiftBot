import {
  inventoryItems,
  notifications,
  products,
  purchases,
  users,
  wallets,
} from "@giftbot/db/schema";
import { and, desc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { writeAuditIn } from "./admin.js";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  GramInvalidTelegramUsernameError,
  InsufficientFundsError,
  ShopInsufficientBalanceError,
  ShopInvalidDonationNicknameError,
  ShopInvalidDonationTextError,
  ShopInvalidKickUsernameError,
  ShopInvalidMediaUrlError,
  ShopInvalidSlotNameError,
  ShopInvalidTelegramUsernameError,
  ShopInvalidWelvuraIdError,
  ShopOrderNotFoundError,
  ShopProductNotFoundError,
  ShopProductUnavailableError,
  ShopRejectionReasonRequiredError,
  WalletNotFoundError,
} from "./errors.js";
import { parseTelegramUsername } from "./gram-withdrawal.js";
import { asBigInt } from "./money.js";
import {
  clampProfileListLimit,
  encodeProfileCursor,
  type OrderReadStatus,
  type ProfileListCursor,
} from "./profile-read.js";
import { assertTransition, shopOrderTransitions } from "./states.js";
import { applyIn } from "./wallet.js";
import { createTtlCache } from "./read-cache.js";

export type ShopFulfillmentType = "manual" | "instant";
export type ShopCategory = "money" | "donations" | "subs" | "other";
export type ShopOrderStatus = OrderReadStatus;
export type ShopRequiredField =
  | "welvuraId"
  | "slotName"
  | "displayNickname"
  | "donationText"
  | "mediaUrl"
  | "telegramUsername"
  | "kickUsername";

export type ShopCatalogProduct = {
  code: string;
  title: string;
  category: ShopCategory;
  priceAzc: bigint;
  fulfillmentType: ShopFulfillmentType;
  requiredFields: ShopRequiredField[];
  description: string;
};

export const SHOP_CATALOG: readonly ShopCatalogProduct[] = [
  {
    code: "welvura-200",
    title: "200 ₽ Welvura",
    category: "money",
    priceAzc: 11111n,
    fulfillmentType: "manual",
    requiredFields: ["welvuraId"],
    description: "Пополнение Welvura на 200 ₽. Admin выдаёт вручную.",
  },
  {
    code: "welvura-500",
    title: "500 ₽ Welvura",
    category: "money",
    priceAzc: 22222n,
    fulfillmentType: "manual",
    requiredFields: ["welvuraId"],
    description: "Пополнение Welvura на 500 ₽. Admin выдаёт вручную.",
  },
  {
    code: "welvura-5000",
    title: "5 000 ₽ Welvura",
    category: "money",
    priceAzc: 199999n,
    fulfillmentType: "manual",
    requiredFields: ["welvuraId"],
    description: "Пополнение Welvura на 5 000 ₽. Admin выдаёт вручную.",
  },
  {
    code: "welvura-bonus-3000",
    title: "БОНУСКА ЗА 3000 ₽",
    category: "money",
    priceAzc: 77777n,
    fulfillmentType: "manual",
    requiredFields: ["welvuraId", "slotName"],
    description: "Укажите свой Welvura ID и название слота для заказа бонуски.",
  },
  {
    code: "donat",
    title: "Донат на стрим",
    category: "donations",
    priceAzc: 1000n,
    fulfillmentType: "manual",
    requiredFields: ["displayNickname", "donationText"],
    description: "Admin размещает донат на стриме вручную.",
  },
  {
    code: "music",
    title: "Заказать музыку",
    category: "other",
    priceAzc: 4000n,
    fulfillmentType: "manual",
    requiredFields: ["mediaUrl"],
    description: "Только YouTube или SoundCloud. Admin добавляет трек вручную.",
  },
  {
    code: "custom-slot",
    title: "ЗАКАЗАТЬ СВОЙ СЛОТ",
    category: "other",
    priceAzc: 5555n,
    fulfillmentType: "manual",
    requiredFields: ["slotName"],
    description: "Укажите название слота, который хотите заказать.",
  },
  {
    code: "streak-freeze",
    title: "Streak Freeze",
    category: "other",
    priceAzc: 1000n,
    fulfillmentType: "instant",
    requiredFields: [],
    description: "Добавляет 1 Streak Freeze в инвентарь сразу после оплаты.",
  },
  {
    code: "vip-kick",
    title: "VIP Kick навсегда",
    category: "subs",
    priceAzc: 149999n,
    fulfillmentType: "manual",
    requiredFields: ["kickUsername"],
    description: "Admin вручную выдаёт VIP на Kick.",
  },
];

const SHOP_BY_CODE = new Map(SHOP_CATALOG.map((item) => [item.code, item]));
const RETIRED_SHOP_SLUGS = ["premium-6", "premium-12"] as const;
const WELVURA_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SLOT_NAME_MAX = 80;
const KICK_USERNAME = /^[A-Za-z0-9_]{3,25}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "music.youtube.com",
]);
const PURCHASE_TO_ORDER: Record<string, ShopOrderStatus> = {
  created: "pending",
  paid: "processing",
  delivered: "fulfilled",
  failed: "rejected",
  refunded: "rejected",
};

export type ShopOrderRecord = {
  id: string;
  userId: string;
  publicId: string | null;
  productCode: string;
  productName: string;
  priceAzc: string;
  status: ShopOrderStatus;
  submittedPayload: Record<string, string>;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  processingAt: string | null;
  fulfilledAt: string | null;
  rejectedAt: string | null;
  processedByAdminId: string | null;
  fulfillmentType: ShopFulfillmentType;
};

export type ShopPurchaseResult = {
  status: ShopOrderStatus;
  orderId: string;
  productCode: string;
  priceAzc: string;
  newBalanceAzc: string;
  replayed: boolean;
  inventoryGranted?: { type: "streak_freeze"; quantity: 1 };
};

export type ShopCatalogItem = {
  code: string;
  title: string;
  category: ShopCategory;
  priceAzc: string;
  fulfillmentType: ShopFulfillmentType;
  requiredFields: ShopRequiredField[];
  description: string;
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function catalogPayload(product: ShopCatalogProduct): Record<string, unknown> {
  return {
    title: product.title,
    category: product.category,
    fulfillmentType: product.fulfillmentType,
    requiredFields: product.requiredFields,
  };
}

export function getShopProduct(code: unknown): ShopCatalogProduct {
  if (typeof code !== "string" || !SHOP_BY_CODE.has(code)) {
    throw new ShopProductNotFoundError();
  }
  return SHOP_BY_CODE.get(code) as ShopCatalogProduct;
}

export function publicShopCatalogItem(
  product: ShopCatalogProduct,
): ShopCatalogItem {
  return {
    code: product.code,
    title: product.title,
    category: product.category,
    priceAzc: product.priceAzc.toString(),
    fulfillmentType: product.fulfillmentType,
    requiredFields: product.requiredFields,
    description: product.description,
  };
}

/** Presentation order is SHOP_CATALOG. Active slugs only gate visibility. */
export function presentShopCatalog(
  activeSlugs: Iterable<string>,
  category?: ShopCategory,
): ShopCatalogItem[] {
  const active = activeSlugs instanceof Set ? activeSlugs : new Set(activeSlugs);
  return SHOP_CATALOG.filter((item) => {
    if (!active.has(item.code)) {
      return false;
    }
    return category === undefined || item.category === category;
  }).map(publicShopCatalogItem);
}

export function parseShopWelvuraId(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ShopInvalidWelvuraIdError();
  }
  const trimmed = raw.trim();
  if (!WELVURA_ID.test(trimmed) || /[<>]/.test(trimmed)) {
    throw new ShopInvalidWelvuraIdError();
  }
  return trimmed;
}

export function parseShopTelegramUsername(raw: unknown): string {
  try {
    return parseTelegramUsername(raw);
  } catch (error) {
    if (error instanceof GramInvalidTelegramUsernameError) {
      throw new ShopInvalidTelegramUsernameError();
    }
    throw error;
  }
}

export function parseShopKickUsername(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ShopInvalidKickUsernameError();
  }
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    /https?:/i.test(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes(".") ||
    trimmed.includes(":")
  ) {
    throw new ShopInvalidKickUsernameError();
  }
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!KICK_USERNAME.test(withoutAt)) {
    throw new ShopInvalidKickUsernameError();
  }
  return withoutAt;
}

export function parseShopSlotName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ShopInvalidSlotNameError();
  }
  const trimmed = raw.trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > SLOT_NAME_MAX ||
    /[<>]/.test(trimmed)
  ) {
    throw new ShopInvalidSlotNameError();
  }
  return trimmed;
}

export function parseDisplayNickname(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ShopInvalidDonationNicknameError();
  }
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 20 || /[<>]/.test(trimmed)) {
    throw new ShopInvalidDonationNicknameError();
  }
  return trimmed;
}

export function parseDonationText(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ShopInvalidDonationTextError();
  }
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 300) {
    throw new ShopInvalidDonationTextError();
  }
  return trimmed;
}

export function parseMediaUrl(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ShopInvalidMediaUrlError();
  }
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ShopInvalidMediaUrlError();
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ShopInvalidMediaUrlError();
  }
  const host = parsed.hostname.toLowerCase();
  const youtube = YOUTUBE_HOSTS.has(host);
  const soundcloud =
    host === "soundcloud.com" ||
    host === "www.soundcloud.com" ||
    host.endsWith(".soundcloud.com");
  if (!youtube && !soundcloud) {
    throw new ShopInvalidMediaUrlError();
  }
  return parsed.toString();
}

export function parseShopRejectionReason(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ShopRejectionReasonRequiredError();
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 500) {
    throw new ShopRejectionReasonRequiredError();
  }
  return trimmed;
}

export function validateShopSubmittedData(
  product: ShopCatalogProduct,
  submitted: unknown,
): Record<string, string> {
  const row = asRecord(submitted);
  const payload: Record<string, string> = {};
  for (const field of product.requiredFields) {
    const value = row[field];
    switch (field) {
      case "welvuraId":
        payload.welvuraId = parseShopWelvuraId(value);
        break;
      case "slotName":
        payload.slotName = parseShopSlotName(value);
        break;
      case "displayNickname":
        payload.displayNickname = parseDisplayNickname(value);
        break;
      case "donationText":
        payload.donationText = parseDonationText(value);
        break;
      case "mediaUrl":
        payload.mediaUrl = parseMediaUrl(value);
        break;
      case "telegramUsername":
        payload.telegramUsername = parseShopTelegramUsername(value);
        break;
      case "kickUsername":
        payload.kickUsername = parseShopKickUsername(value);
        break;
    }
  }
  return payload;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function publicStatus(status: string): ShopOrderStatus {
  return PURCHASE_TO_ORDER[status] ?? "pending";
}

function serializeOrder(
  row: typeof purchases.$inferSelect,
  extra: { publicId?: string | null; fulfillmentType?: ShopFulfillmentType } = {},
): ShopOrderRecord {
  const payload = asRecord(row.submittedPayload);
  const submittedPayload: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" && value.length > 0) {
      submittedPayload[key] = value;
    }
  }
  const catalog = SHOP_BY_CODE.get(row.productCode ?? "");
  return {
    id: row.id,
    userId: row.userId,
    publicId: extra.publicId ?? null,
    productCode: row.productCode ?? catalog?.code ?? "",
    productName: row.productNameSnapshot ?? catalog?.title ?? row.productCode ?? "",
    priceAzc: asBigInt(row.priceMinor).toString(),
    status: publicStatus(row.status),
    submittedPayload,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    processingAt: toIso(row.processingAt),
    fulfilledAt: toIso(row.fulfilledAt),
    rejectedAt: toIso(row.rejectedAt),
    processedByAdminId: row.processedByAdminId,
    fulfillmentType:
      extra.fulfillmentType ?? catalog?.fulfillmentType ?? "manual",
  };
}

async function readBalanceAzc(tx: GiftbotTx, userId: string): Promise<string> {
  const rows = await tx
    .select({ balanceMinor: wallets.balanceMinor })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return asBigInt(rows[0]?.balanceMinor ?? 0n).toString();
}

async function loadPublicId(tx: GiftbotTx, userId: string): Promise<string | null> {
  const rows = await tx
    .select({ publicId: users.publicId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.publicId ?? null;
}

async function insertInbox(
  tx: GiftbotTx,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    orderId: string;
  },
): Promise<void> {
  await tx.insert(notifications).values({
    userId: input.userId,
    channel: "inbox",
    type: input.type,
    status: "sent",
    title: input.title,
    body: input.body,
    sentAt: new Date(),
    payload: { orderId: input.orderId },
  });
}

async function grantStreakFreeze(
  tx: GiftbotTx,
  userId: string,
  orderId: string,
): Promise<void> {
  const rows = await tx
    .select()
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.itemType, "streak_freeze"),
        eq(inventoryItems.status, "available"),
      ),
    )
    .for("update")
    .limit(1);
  const current = rows[0];
  if (current) {
    await tx
      .update(inventoryItems)
      .set({ quantity: current.quantity + 1 })
      .where(eq(inventoryItems.id, current.id));
    return;
  }
  await tx.insert(inventoryItems).values({
    userId,
    itemType: "streak_freeze",
    status: "available",
    quantity: 1,
    source: `shop:${orderId}`,
  });
}

export async function ensureShopCatalog(db: GiftbotDb): Promise<void> {
  for (const product of SHOP_CATALOG) {
    await db
      .insert(products)
      .values({
        slug: product.code,
        type:
          product.fulfillmentType === "instant" ? "shop_instant" : "shop_manual",
        priceMinor: product.priceAzc,
        status: "active",
        payload: catalogPayload(product),
      })
      .onConflictDoUpdate({
        target: products.slug,
        set: {
          type:
            product.fulfillmentType === "instant"
              ? "shop_instant"
              : "shop_manual",
          priceMinor: product.priceAzc,
          status: "active",
          payload: catalogPayload(product),
        },
      });
  }
  await db
    .update(products)
    .set({ status: "disabled" })
    .where(inArray(products.slug, [...RETIRED_SHOP_SLUGS]));
  shopCatalogCache.invalidate();
}

const shopCatalogCache = createTtlCache<ShopCatalogItem[]>(15_000);

export async function listShopCatalog(db: GiftbotDb): Promise<ShopCatalogItem[]> {
  return shopCatalogCache.get(async () => {
    const rows = await db
      .select({ slug: products.slug, status: products.status })
      .from(products)
      .where(eq(products.status, "active"));
    return presentShopCatalog(rows.map((row) => row.slug));
  });
}

async function loadExistingPurchase(
  tx: GiftbotTx,
  userId: string,
  idempotencyKey: string,
) {
  const rows = await tx
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createShopOrder(
  db: GiftbotDb,
  input: {
    userId: string;
    productCode: unknown;
    submittedData: unknown;
    idempotencyKey: string;
  },
): Promise<ShopPurchaseResult> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  const catalog = getShopProduct(input.productCode);
  const submitted = validateShopSubmittedData(catalog, input.submittedData);

  return db.transaction(async (tx) => {
    const walletRows = await tx
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, input.userId))
      .for("update")
      .limit(1);
    if (!walletRows[0]) {
      throw new WalletNotFoundError();
    }
    const replay = await loadExistingPurchase(
      tx,
      input.userId,
      input.idempotencyKey,
    );
    if (replay) {
      return {
        status: publicStatus(replay.status),
        orderId: replay.id,
        productCode: catalog.code,
        priceAzc: catalog.priceAzc.toString(),
        newBalanceAzc: await readBalanceAzc(tx, input.userId),
        replayed: true,
        ...(catalog.fulfillmentType === "instant"
          ? { inventoryGranted: { type: "streak_freeze" as const, quantity: 1 as const } }
          : {}),
      };
    }

    const productRows = await tx
      .select()
      .from(products)
      .where(eq(products.slug, catalog.code))
      .for("update")
      .limit(1);
    const product = productRows[0];
    if (!product) {
      throw new ShopProductNotFoundError();
    }
    if (product.status !== "active") {
      throw new ShopProductUnavailableError();
    }

    let inserted: typeof purchases.$inferSelect;
    try {
      const created = await tx
        .insert(purchases)
        .values({
          userId: input.userId,
          productId: product.id,
          status: "created",
          priceMinor: catalog.priceAzc,
          idempotencyKey: input.idempotencyKey,
          submittedPayload: submitted,
          productCode: catalog.code,
          productNameSnapshot: catalog.title,
        })
        .returning();
      const row = created[0];
      if (!row) {
        throw new Error("failed to create shop order");
      }
      inserted = row;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await loadExistingPurchase(
        tx,
        input.userId,
        input.idempotencyKey,
      );
      if (raced) {
        return {
          status: publicStatus(raced.status),
          orderId: raced.id,
          productCode: catalog.code,
          priceAzc: catalog.priceAzc.toString(),
          newBalanceAzc: await readBalanceAzc(tx, input.userId),
          replayed: true,
          ...(catalog.fulfillmentType === "instant"
            ? {
                inventoryGranted: {
                  type: "streak_freeze" as const,
                  quantity: 1 as const,
                },
              }
            : {}),
        };
      }
      throw error;
    }

    let paid;
    try {
      paid = await applyIn(tx, {
        userId: input.userId,
        type: "shop_purchase",
        amountMinor: -catalog.priceAzc,
        idempotencyKey: `shop.purchase:${inserted.id}`,
        actorType: "user",
        actorId: input.userId,
        referenceType: "purchase",
        referenceId: inserted.id,
        metadata: {
          orderId: inserted.id,
          productCode: catalog.code,
          productName: catalog.title,
          priceAzc: catalog.priceAzc.toString(),
        },
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new ShopInsufficientBalanceError();
      }
      throw error;
    }

    const now = new Date();
    const nextStatus =
      catalog.fulfillmentType === "instant" ? "delivered" : "created";
    if (catalog.fulfillmentType === "instant") {
      await grantStreakFreeze(tx, input.userId, inserted.id);
    }
    const updated = await tx
      .update(purchases)
      .set({
        status: nextStatus,
        walletTransactionId: paid.transaction.id,
        updatedAt: now,
        ...(catalog.fulfillmentType === "instant"
          ? { fulfilledAt: now }
          : {}),
      })
      .where(eq(purchases.id, inserted.id))
      .returning();
    const next = updated[0] ?? inserted;

    await insertInbox(tx, {
      userId: input.userId,
      type:
        catalog.fulfillmentType === "instant"
          ? "shop_order_fulfilled"
          : "shop_order_created",
      title:
        catalog.fulfillmentType === "instant"
          ? "Streak Freeze добавлен в инвентарь"
          : "Заказ создан",
      body:
        catalog.fulfillmentType === "instant"
          ? "Streak Freeze добавлен в инвентарь"
          : `${catalog.title} — заявка отправлена`,
      orderId: next.id,
    });

    return {
      status: publicStatus(next.status),
      orderId: next.id,
      productCode: catalog.code,
      priceAzc: catalog.priceAzc.toString(),
      newBalanceAzc: paid.wallet.balanceMinor.toString(),
      replayed: false,
      ...(catalog.fulfillmentType === "instant"
        ? { inventoryGranted: { type: "streak_freeze" as const, quantity: 1 as const } }
        : {}),
    };
  });
}

async function lockOrder(tx: GiftbotTx, orderId: string) {
  const rows = await tx
    .select()
    .from(purchases)
    .where(eq(purchases.id, orderId))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new ShopOrderNotFoundError();
  }
  return row;
}

export async function markShopOrderProcessing(
  db: GiftbotDb,
  input: {
    orderId: string;
    adminUserId: string;
    idempotencyKey: string;
  },
): Promise<{ order: ShopOrderRecord; auditId?: string; replayed: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  return db.transaction(async (tx) => {
    const current = await lockOrder(tx, input.orderId);
    const from = publicStatus(current.status);
    if (from === "processing") {
      return {
        order: serializeOrder(current, {
          publicId: await loadPublicId(tx, current.userId),
        }),
        replayed: true,
      };
    }
    assertTransition("shop_order", shopOrderTransitions, from, "processing");
    const now = new Date();
    const updated = await tx
      .update(purchases)
      .set({
        status: "paid",
        processingAt: now,
        updatedAt: now,
        processedByAdminId: input.adminUserId,
      })
      .where(eq(purchases.id, current.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to mark shop order processing");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "shop_order.processing",
      targetType: "shop_order",
      targetId: next.id,
      reason: "mark shop order processing",
      before: { status: from, userId: current.userId },
      after: {
        status: "processing",
        productCode: next.productCode,
        priceAzc: asBigInt(next.priceMinor).toString(),
        idempotencyKey: input.idempotencyKey,
      },
    });
    return {
      order: serializeOrder(next, {
        publicId: await loadPublicId(tx, next.userId),
      }),
      auditId,
      replayed: false,
    };
  });
}

export async function fulfillShopOrder(
  db: GiftbotDb,
  input: {
    orderId: string;
    adminUserId: string;
    idempotencyKey: string;
  },
): Promise<{ order: ShopOrderRecord; auditId?: string; replayed: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  return db.transaction(async (tx) => {
    const current = await lockOrder(tx, input.orderId);
    const from = publicStatus(current.status);
    if (from === "fulfilled") {
      return {
        order: serializeOrder(current, {
          publicId: await loadPublicId(tx, current.userId),
        }),
        replayed: true,
      };
    }
    assertTransition("shop_order", shopOrderTransitions, from, "fulfilled");
    const now = new Date();
    const updated = await tx
      .update(purchases)
      .set({
        status: "delivered",
        fulfilledAt: now,
        updatedAt: now,
        processedByAdminId: input.adminUserId,
      })
      .where(eq(purchases.id, current.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to fulfill shop order");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "shop_order.fulfilled",
      targetType: "shop_order",
      targetId: next.id,
      reason: "fulfill shop order",
      before: {
        status: from,
        userId: current.userId,
        productCode: current.productCode,
        priceAzc: asBigInt(current.priceMinor).toString(),
      },
      after: {
        status: "fulfilled",
        idempotencyKey: input.idempotencyKey,
      },
    });
    await insertInbox(tx, {
      userId: current.userId,
      type: "shop_order_fulfilled",
      title: "Заказ выполнен",
      body: `${next.productNameSnapshot ?? next.productCode} выполнен`,
      orderId: next.id,
    });
    return {
      order: serializeOrder(next, {
        publicId: await loadPublicId(tx, next.userId),
      }),
      auditId,
      replayed: false,
    };
  });
}

export async function rejectShopOrder(
  db: GiftbotDb,
  input: {
    orderId: string;
    adminUserId: string;
    reason: unknown;
    idempotencyKey: string;
  },
): Promise<{ order: ShopOrderRecord; auditId?: string; replayed: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  const reason = parseShopRejectionReason(input.reason);
  return db.transaction(async (tx) => {
    const current = await lockOrder(tx, input.orderId);
    const from = publicStatus(current.status);
    if (from === "rejected") {
      return {
        order: serializeOrder(current, {
          publicId: await loadPublicId(tx, current.userId),
        }),
        replayed: true,
      };
    }
    assertTransition("shop_order", shopOrderTransitions, from, "rejected");
    const price = asBigInt(current.priceMinor);
    await applyIn(tx, {
      userId: current.userId,
      type: "shop_refund",
      amountMinor: price,
      idempotencyKey: `shop.refund:${current.id}`,
      actorType: "admin",
      actorId: input.adminUserId,
      referenceType: "purchase",
      referenceId: current.id,
      reason,
      metadata: {
        orderId: current.id,
        productCode: current.productCode,
        originalPriceAzc: price.toString(),
        rejectionReason: reason,
      },
    });
    const now = new Date();
    const updated = await tx
      .update(purchases)
      .set({
        status: "refunded",
        rejectionReason: reason,
        rejectedAt: now,
        updatedAt: now,
        processedByAdminId: input.adminUserId,
      })
      .where(eq(purchases.id, current.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to reject shop order");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "shop_order.rejected",
      targetType: "shop_order",
      targetId: next.id,
      reason,
      before: {
        status: from,
        userId: current.userId,
        productCode: current.productCode,
        priceAzc: price.toString(),
      },
      after: {
        status: "rejected",
        refundedAzc: price.toString(),
        idempotencyKey: input.idempotencyKey,
      },
    });
    await insertInbox(tx, {
      userId: current.userId,
      type: "shop_order_rejected",
      title: "Заказ отклонён",
      body: `Заказ отклонён. Возвращено ${price.toString()} AZC. Причина: ${reason}`,
      orderId: next.id,
    });
    return {
      order: serializeOrder(next, {
        publicId: await loadPublicId(tx, next.userId),
      }),
      auditId,
      replayed: false,
    };
  });
}

export async function listAdminShopOrders(
  db: GiftbotDb,
  input: {
    limit?: number;
    cursor?: ProfileListCursor;
    status?: ShopOrderStatus | "all";
    productCode?: string;
  } = {},
): Promise<{ items: ShopOrderRecord[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const cursor = input.cursor;
  const status =
    input.status && input.status !== "all" ? input.status : undefined;
  const purchaseStatuses = status
    ? (Object.entries(PURCHASE_TO_ORDER) as Array<[string, ShopOrderStatus]>)
        .filter(([, mapped]) => mapped === status)
        .map(([dbStatus]) => dbStatus as (typeof purchases.status.enumValues)[number])
    : undefined;
  const cursorFilter = cursor
    ? or(
        lt(purchases.createdAt, new Date(cursor.createdAt)),
        and(
          eq(purchases.createdAt, new Date(cursor.createdAt)),
          lt(purchases.id, cursor.id),
        ),
      )
    : undefined;
  const rows = await db
    .select({
      purchase: purchases,
      publicId: users.publicId,
    })
    .from(purchases)
    .innerJoin(users, eq(users.id, purchases.userId))
    .where(
      and(
        isNotNull(purchases.productCode),
        ...(purchaseStatuses && purchaseStatuses.length > 0
          ? [inArray(purchases.status, purchaseStatuses)]
          : []),
        ...(input.productCode
          ? [eq(purchases.productCode, input.productCode)]
          : []),
        ...(cursorFilter ? [cursorFilter] : []),
      ),
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const extra = rows[limit];
  return {
    items: page.map((row) =>
      serializeOrder(row.purchase, { publicId: row.publicId }),
    ),
    nextCursor: extra
      ? encodeProfileCursor({
          createdAt: extra.purchase.createdAt.toISOString(),
          id: extra.purchase.id,
        })
      : null,
  };
}
