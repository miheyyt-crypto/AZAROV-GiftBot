import {
  cashItemWithdrawals,
  inventoryItems,
  notifications,
  telegramAccounts,
  users,
} from "@giftbot/db/schema";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { writeAuditIn } from "./admin.js";
import {
  CashItemInvalidTypeError,
  CashItemNotAvailableError,
  CashItemNotFoundError,
  CashItemNotOwnedError,
  CashRejectionReasonRequiredError,
  CashWithdrawalAlreadyActiveError,
  CashWithdrawalInvalidWelvuraIdError,
  CashWithdrawalNotFoundError,
} from "./errors.js";
import { asBigInt } from "./money.js";
import {
  clampProfileListLimit,
  encodeProfileCursor,
  type ProfileListCursor,
} from "./profile-read.js";
import {
  assertTransition,
  cashItemWithdrawalTransitions,
} from "./states.js";

export type CashItemWithdrawalStatus =
  | "pending"
  | "processing"
  | "fulfilled"
  | "rejected";

export type CashItemWithdrawalRecord = {
  id: string;
  userId: string;
  publicId: string | null;
  telegramUsername: string | null;
  inventoryItemId: string;
  amountRub: string;
  welvuraId: string;
  source: string;
  status: CashItemWithdrawalStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  processingAt: string | null;
  fulfilledAt: string | null;
  rejectedAt: string | null;
  processedByAdminId: string | null;
};

export type CashActiveWithdrawalSummary = {
  id: string;
  status: CashItemWithdrawalStatus;
  welvuraId: string;
  createdAt: string;
};

const WELVURA_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ACTIVE_STATUSES = ["pending", "processing"] as const;

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

export function formatCashRubAmount(amount: bigint): string {
  const digits = amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${digits} ₽`;
}

export function parseCashWelvuraId(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new CashWithdrawalInvalidWelvuraIdError();
  }
  const trimmed = raw.trim();
  let hasControl = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      hasControl = true;
      break;
    }
  }
  if (
    trimmed.length === 0 ||
    hasControl ||
    /https?:/i.test(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes(".") ||
    trimmed.includes(":") ||
    /[<>]/.test(trimmed) ||
    !WELVURA_ID.test(trimmed)
  ) {
    throw new CashWithdrawalInvalidWelvuraIdError();
  }
  return trimmed;
}

export function parseCashRejectionReason(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new CashRejectionReasonRequiredError();
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 500) {
    throw new CashRejectionReasonRequiredError();
  }
  return trimmed;
}

function serializeWithdrawal(
  row: typeof cashItemWithdrawals.$inferSelect,
  extra: {
    publicId?: string | null;
    telegramUsername?: string | null;
    source?: string | null;
  } = {},
): CashItemWithdrawalRecord {
  return {
    id: row.id,
    userId: row.userId,
    publicId: extra.publicId ?? null,
    telegramUsername: extra.telegramUsername ?? null,
    inventoryItemId: row.inventoryItemId,
    amountRub: asBigInt(row.amountRub).toString(),
    welvuraId: row.welvuraId,
    source: extra.source ?? "",
    status: row.status,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    processingAt: row.processingAt ? row.processingAt.toISOString() : null,
    fulfilledAt: row.fulfilledAt ? row.fulfilledAt.toISOString() : null,
    rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
    processedByAdminId: row.processedByAdminId,
  };
}

async function loadPublicId(tx: GiftbotTx, userId: string): Promise<string | null> {
  const rows = await tx
    .select({ publicId: users.publicId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.publicId ?? null;
}

async function loadTelegramUsername(
  tx: GiftbotTx,
  userId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ username: telegramAccounts.username })
    .from(telegramAccounts)
    .where(
      and(
        eq(telegramAccounts.userId, userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .limit(1);
  return rows[0]?.username ?? null;
}

async function loadItemSource(
  tx: GiftbotTx,
  itemId: string,
): Promise<string> {
  const rows = await tx
    .select({ source: inventoryItems.source })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .limit(1);
  return rows[0]?.source ?? "";
}

async function lockInventoryItem(tx: GiftbotTx, itemId: string) {
  const rows = await tx
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new CashItemNotFoundError();
  }
  return row;
}

async function peekWithdrawal(tx: GiftbotTx, withdrawalId: string) {
  const rows = await tx
    .select()
    .from(cashItemWithdrawals)
    .where(eq(cashItemWithdrawals.id, withdrawalId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new CashWithdrawalNotFoundError();
  }
  return row;
}

async function lockWithdrawal(tx: GiftbotTx, withdrawalId: string) {
  const rows = await tx
    .select()
    .from(cashItemWithdrawals)
    .where(eq(cashItemWithdrawals.id, withdrawalId))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new CashWithdrawalNotFoundError();
  }
  return row;
}

async function insertInbox(
  tx: GiftbotTx,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    withdrawalId: string;
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
    payload: { cashWithdrawalId: input.withdrawalId },
  });
}

async function serializeFull(
  tx: GiftbotTx,
  row: typeof cashItemWithdrawals.$inferSelect,
): Promise<CashItemWithdrawalRecord> {
  return serializeWithdrawal(row, {
    publicId: await loadPublicId(tx, row.userId),
    telegramUsername: await loadTelegramUsername(tx, row.userId),
    source: await loadItemSource(tx, row.inventoryItemId),
  });
}

export async function createCashItemWithdrawal(
  db: GiftbotDb,
  input: {
    userId: string;
    itemId: string;
    welvuraId: unknown;
    idempotencyKey: string;
  },
): Promise<{ withdrawal: CashItemWithdrawalRecord; replayed: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  const welvuraId = parseCashWelvuraId(input.welvuraId);

  return db.transaction(async (tx) => {
    const item = await lockInventoryItem(tx, input.itemId);

    const existingKey = await tx
      .select()
      .from(cashItemWithdrawals)
      .where(
        and(
          eq(cashItemWithdrawals.userId, input.userId),
          eq(cashItemWithdrawals.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    const replay = existingKey[0];
    if (replay) {
      return {
        withdrawal: await serializeFull(tx, replay),
        replayed: true,
      };
    }

    if (item.userId !== input.userId) {
      throw new CashItemNotOwnedError();
    }
    if (item.itemType !== "cash_rub") {
      throw new CashItemInvalidTypeError();
    }
    if (item.status !== "available") {
      throw new CashItemNotAvailableError();
    }
    const amount = asBigInt(item.amountRub ?? 0n);
    if (amount <= 0n) {
      throw new CashItemNotAvailableError();
    }

    const active = await tx
      .select()
      .from(cashItemWithdrawals)
      .where(
        and(
          eq(cashItemWithdrawals.inventoryItemId, item.id),
          inArray(cashItemWithdrawals.status, [...ACTIVE_STATUSES]),
        ),
      )
      .for("update")
      .limit(1);
    if (active[0]) {
      throw new CashWithdrawalAlreadyActiveError();
    }

    let inserted: typeof cashItemWithdrawals.$inferSelect;
    try {
      const rows = await tx
        .insert(cashItemWithdrawals)
        .values({
          userId: input.userId,
          inventoryItemId: item.id,
          amountRub: amount,
          welvuraId,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("failed to create cash withdrawal");
      }
      inserted = row;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const racedKey = await tx
        .select()
        .from(cashItemWithdrawals)
        .where(
          and(
            eq(cashItemWithdrawals.userId, input.userId),
            eq(cashItemWithdrawals.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (racedKey[0]) {
        return {
          withdrawal: await serializeFull(tx, racedKey[0]),
          replayed: true,
        };
      }
      throw new CashWithdrawalAlreadyActiveError();
    }

    await tx
      .update(inventoryItems)
      .set({ status: "reserved" })
      .where(eq(inventoryItems.id, item.id));

    await insertInbox(tx, {
      userId: input.userId,
      type: "cash_withdrawal_created",
      title: "Заявка на получение приза создана",
      body: `Приз ${formatCashRubAmount(amount)} отправлен на обработку`,
      withdrawalId: inserted.id,
    });

    return {
      withdrawal: await serializeFull(tx, inserted),
      replayed: false,
    };
  });
}

export async function markCashItemWithdrawalProcessing(
  db: GiftbotDb,
  input: {
    withdrawalId: string;
    adminUserId: string;
    idempotencyKey: string;
  },
): Promise<{
  withdrawal: CashItemWithdrawalRecord;
  auditId?: string;
  replayed: boolean;
}> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  return db.transaction(async (tx) => {
    const current = await lockWithdrawal(tx, input.withdrawalId);
    if (current.status === "processing") {
      return {
        withdrawal: await serializeFull(tx, current),
        replayed: true,
      };
    }
    assertTransition(
      "cash_withdrawal",
      cashItemWithdrawalTransitions,
      current.status,
      "processing",
    );
    const now = new Date();
    const updated = await tx
      .update(cashItemWithdrawals)
      .set({
        status: "processing",
        processingAt: now,
        updatedAt: now,
        processedByAdminId: input.adminUserId,
      })
      .where(eq(cashItemWithdrawals.id, current.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to mark cash withdrawal processing");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "cash_withdrawal.processing",
      targetType: "cash_withdrawal",
      targetId: next.id,
      reason: "mark cash withdrawal processing",
      before: { status: current.status },
      after: {
        status: next.status,
        inventoryItemId: next.inventoryItemId,
        userId: next.userId,
        amountRub: asBigInt(next.amountRub).toString(),
        transition: `${current.status}->processing`,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return {
      withdrawal: await serializeFull(tx, next),
      auditId,
      replayed: false,
    };
  });
}

export async function fulfillCashItemWithdrawal(
  db: GiftbotDb,
  input: {
    withdrawalId: string;
    adminUserId: string;
    idempotencyKey: string;
  },
): Promise<{
  withdrawal: CashItemWithdrawalRecord;
  auditId?: string;
  replayed: boolean;
}> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  return db.transaction(async (tx) => {
    const preview = await peekWithdrawal(tx, input.withdrawalId);
    if (preview.status === "fulfilled") {
      return {
        withdrawal: await serializeFull(tx, preview),
        replayed: true,
      };
    }
    const item = await lockInventoryItem(tx, preview.inventoryItemId);
    const current = await lockWithdrawal(tx, input.withdrawalId);
    if (current.status === "fulfilled") {
      return {
        withdrawal: await serializeFull(tx, current),
        replayed: true,
      };
    }
    assertTransition(
      "cash_withdrawal",
      cashItemWithdrawalTransitions,
      current.status,
      "fulfilled",
    );
    if (item.status !== "reserved") {
      throw new CashItemNotAvailableError();
    }
    const now = new Date();
    await tx
      .update(inventoryItems)
      .set({ status: "consumed" })
      .where(eq(inventoryItems.id, item.id));
    const updated = await tx
      .update(cashItemWithdrawals)
      .set({
        status: "fulfilled",
        fulfilledAt: now,
        updatedAt: now,
        processedByAdminId: input.adminUserId,
      })
      .where(eq(cashItemWithdrawals.id, current.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to fulfill cash withdrawal");
    }
    const amount = asBigInt(next.amountRub);
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "cash_withdrawal.fulfilled",
      targetType: "cash_withdrawal",
      targetId: next.id,
      reason: "fulfill cash withdrawal",
      before: {
        status: current.status,
        itemStatus: item.status,
      },
      after: {
        status: next.status,
        itemStatus: "consumed",
        inventoryItemId: next.inventoryItemId,
        userId: next.userId,
        amountRub: amount.toString(),
        transition: `${current.status}->fulfilled`,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await insertInbox(tx, {
      userId: current.userId,
      type: "cash_withdrawal_fulfilled",
      title: "Приз выдан",
      body: `Заявка на ${formatCashRubAmount(amount)} выполнена`,
      withdrawalId: next.id,
    });
    return {
      withdrawal: await serializeFull(tx, next),
      auditId,
      replayed: false,
    };
  });
}

export async function rejectCashItemWithdrawal(
  db: GiftbotDb,
  input: {
    withdrawalId: string;
    adminUserId: string;
    reason: unknown;
    idempotencyKey: string;
  },
): Promise<{
  withdrawal: CashItemWithdrawalRecord;
  auditId?: string;
  replayed: boolean;
}> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  const reason = parseCashRejectionReason(input.reason);
  return db.transaction(async (tx) => {
    const preview = await peekWithdrawal(tx, input.withdrawalId);
    if (preview.status === "rejected") {
      return {
        withdrawal: await serializeFull(tx, preview),
        replayed: true,
      };
    }
    const item = await lockInventoryItem(tx, preview.inventoryItemId);
    const current = await lockWithdrawal(tx, input.withdrawalId);
    if (current.status === "rejected") {
      return {
        withdrawal: await serializeFull(tx, current),
        replayed: true,
      };
    }
    assertTransition(
      "cash_withdrawal",
      cashItemWithdrawalTransitions,
      current.status,
      "rejected",
    );
    if (item.status !== "reserved") {
      throw new CashItemNotAvailableError();
    }
    const now = new Date();
    await tx
      .update(inventoryItems)
      .set({ status: "available" })
      .where(eq(inventoryItems.id, item.id));
    const updated = await tx
      .update(cashItemWithdrawals)
      .set({
        status: "rejected",
        rejectionReason: reason,
        rejectedAt: now,
        updatedAt: now,
        processedByAdminId: input.adminUserId,
      })
      .where(eq(cashItemWithdrawals.id, current.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to reject cash withdrawal");
    }
    const amount = asBigInt(next.amountRub);
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "cash_withdrawal.rejected",
      targetType: "cash_withdrawal",
      targetId: next.id,
      reason,
      before: {
        status: current.status,
        itemStatus: item.status,
      },
      after: {
        status: next.status,
        itemStatus: "available",
        inventoryItemId: next.inventoryItemId,
        userId: next.userId,
        amountRub: amount.toString(),
        transition: `${current.status}->rejected`,
        rejectionReason: reason,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await insertInbox(tx, {
      userId: current.userId,
      type: "cash_withdrawal_rejected",
      title: "Заявка отклонена",
      body: `Приз ${formatCashRubAmount(amount)} снова доступен. Причина: ${reason}`,
      withdrawalId: next.id,
    });
    return {
      withdrawal: await serializeFull(tx, next),
      auditId,
      replayed: false,
    };
  });
}

export async function listUserCashItemWithdrawals(
  db: GiftbotDb,
  input: { userId: string; limit?: number; cursor?: ProfileListCursor },
): Promise<{ items: CashItemWithdrawalRecord[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const cursor = input.cursor;
  const cursorFilter = cursor
    ? or(
        lt(cashItemWithdrawals.createdAt, new Date(cursor.createdAt)),
        and(
          eq(cashItemWithdrawals.createdAt, new Date(cursor.createdAt)),
          lt(cashItemWithdrawals.id, cursor.id),
        ),
      )
    : undefined;
  const rows = await db
    .select({
      withdrawal: cashItemWithdrawals,
      source: inventoryItems.source,
    })
    .from(cashItemWithdrawals)
    .innerJoin(
      inventoryItems,
      eq(inventoryItems.id, cashItemWithdrawals.inventoryItemId),
    )
    .where(
      cursorFilter
        ? and(eq(cashItemWithdrawals.userId, input.userId), cursorFilter)
        : eq(cashItemWithdrawals.userId, input.userId),
    )
    .orderBy(desc(cashItemWithdrawals.createdAt), desc(cashItemWithdrawals.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const extra = rows[limit];
  return {
    items: page.map((row) =>
      serializeWithdrawal(row.withdrawal, { source: row.source }),
    ),
    nextCursor: extra
      ? encodeProfileCursor({
          createdAt: extra.withdrawal.createdAt.toISOString(),
          id: extra.withdrawal.id,
        })
      : null,
  };
}

export async function listAdminCashItemWithdrawals(
  db: GiftbotDb,
  input: {
    limit?: number;
    cursor?: ProfileListCursor;
    status?: CashItemWithdrawalStatus | "all";
  } = {},
): Promise<{ items: CashItemWithdrawalRecord[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const cursor = input.cursor;
  const status =
    input.status && input.status !== "all" ? input.status : undefined;
  const cursorFilter = cursor
    ? or(
        lt(cashItemWithdrawals.createdAt, new Date(cursor.createdAt)),
        and(
          eq(cashItemWithdrawals.createdAt, new Date(cursor.createdAt)),
          lt(cashItemWithdrawals.id, cursor.id),
        ),
      )
    : undefined;
  const filters = [
    ...(status ? [eq(cashItemWithdrawals.status, status)] : []),
    ...(cursorFilter ? [cursorFilter] : []),
  ];
  const rows = await db
    .select({
      withdrawal: cashItemWithdrawals,
      publicId: users.publicId,
      telegramUsername: telegramAccounts.username,
      source: inventoryItems.source,
    })
    .from(cashItemWithdrawals)
    .innerJoin(users, eq(users.id, cashItemWithdrawals.userId))
    .innerJoin(
      inventoryItems,
      eq(inventoryItems.id, cashItemWithdrawals.inventoryItemId),
    )
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, cashItemWithdrawals.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(cashItemWithdrawals.createdAt), desc(cashItemWithdrawals.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const extra = rows[limit];
  return {
    items: page.map((row) =>
      serializeWithdrawal(row.withdrawal, {
        publicId: row.publicId,
        telegramUsername: row.telegramUsername,
        source: row.source,
      }),
    ),
    nextCursor: extra
      ? encodeProfileCursor({
          createdAt: extra.withdrawal.createdAt.toISOString(),
          id: extra.withdrawal.id,
        })
      : null,
  };
}

export async function loadActiveCashWithdrawalsByItemIds(
  db: GiftbotDb,
  userId: string,
  itemIds: string[],
): Promise<Map<string, CashActiveWithdrawalSummary>> {
  const map = new Map<string, CashActiveWithdrawalSummary>();
  if (itemIds.length === 0) {
    return map;
  }
  const rows = await db
    .select()
    .from(cashItemWithdrawals)
    .where(
      and(
        eq(cashItemWithdrawals.userId, userId),
        inArray(cashItemWithdrawals.inventoryItemId, itemIds),
        inArray(cashItemWithdrawals.status, [...ACTIVE_STATUSES]),
      ),
    );
  for (const row of rows) {
    map.set(row.inventoryItemId, {
      id: row.id,
      status: row.status,
      welvuraId: row.welvuraId,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return map;
}
