import {
  gramBalances,
  gramWithdrawals,
  notifications,
  users,
} from "@giftbot/db/schema";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { writeAuditIn } from "./admin.js";
import {
  GramBalanceNotFoundError,
  GramInvalidTelegramUsernameError,
  GramWithdrawalAlreadyActiveError,
  GramWithdrawalMinimumError,
  GramWithdrawalNotFoundError,
  GramRejectionReasonRequiredError,
} from "./errors.js";
import {
  GRAM_MIN_WITHDRAWAL_MINOR,
  formatGramMinor,
  gramAvailableMinor,
} from "./gram.js";
import { asBigInt } from "./money.js";
import {
  clampProfileListLimit,
  encodeProfileCursor,
  type ProfileListCursor,
} from "./profile-read.js";
import { assertTransition, gramWithdrawalTransitions } from "./states.js";

export type GramWithdrawalStatus =
  | "pending"
  | "processing"
  | "fulfilled"
  | "rejected";

export type GramWithdrawalRecord = {
  id: string;
  userId: string;
  publicId: string | null;
  amountGram: string;
  telegramUsername: string;
  status: GramWithdrawalStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  processingAt: string | null;
  fulfilledAt: string | null;
  rejectedAt: string | null;
  processedByAdminId: string | null;
};

const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
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

export function parseTelegramUsername(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new GramInvalidTelegramUsernameError();
  }
  const trimmed = raw.trim();
  if (
    trimmed.length === 0 ||
    /https?:/i.test(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes(".") ||
    trimmed.includes(":")
  ) {
    throw new GramInvalidTelegramUsernameError();
  }
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!TELEGRAM_USERNAME.test(withoutAt)) {
    throw new GramInvalidTelegramUsernameError();
  }
  return withoutAt;
}

export function parseRejectionReason(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new GramRejectionReasonRequiredError();
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 500) {
    throw new GramRejectionReasonRequiredError();
  }
  return trimmed;
}

function serializeWithdrawal(
  row: typeof gramWithdrawals.$inferSelect,
  publicId: string | null = null,
): GramWithdrawalRecord {
  return {
    id: row.id,
    userId: row.userId,
    publicId,
    amountGram: formatGramMinor(asBigInt(row.amountMinor)),
    telegramUsername: row.telegramUsername,
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

async function lockGramBalance(tx: GiftbotTx, userId: string) {
  const rows = await tx
    .select()
    .from(gramBalances)
    .where(eq(gramBalances.userId, userId))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new GramBalanceNotFoundError();
  }
  return row;
}

async function peekWithdrawal(tx: GiftbotTx, withdrawalId: string) {
  const rows = await tx
    .select()
    .from(gramWithdrawals)
    .where(eq(gramWithdrawals.id, withdrawalId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new GramWithdrawalNotFoundError();
  }
  return row;
}

async function lockWithdrawal(tx: GiftbotTx, withdrawalId: string) {
  const rows = await tx
    .select()
    .from(gramWithdrawals)
    .where(eq(gramWithdrawals.id, withdrawalId))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new GramWithdrawalNotFoundError();
  }
  return row;
}

async function insertInbox(
  tx: GiftbotTx,
  input: { userId: string; type: string; title: string; body: string; withdrawalId: string },
): Promise<void> {
  await tx.insert(notifications).values({
    userId: input.userId,
    channel: "inbox",
    type: input.type,
    status: "sent",
    title: input.title,
    body: input.body,
    sentAt: new Date(),
    payload: { withdrawalId: input.withdrawalId },
  });
}

async function loadPublicId(tx: GiftbotTx, userId: string): Promise<string | null> {
  const rows = await tx
    .select({ publicId: users.publicId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.publicId ?? null;
}

export async function createGramWithdrawal(
  db: GiftbotDb,
  input: {
    userId: string;
    telegramUsername: unknown;
    idempotencyKey: string;
  },
): Promise<{ withdrawal: GramWithdrawalRecord; replayed: boolean }> {
  const username = parseTelegramUsername(input.telegramUsername);
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }

  return db.transaction(async (tx) => {
    const balance = await lockGramBalance(tx, input.userId);
    const existingKey = await tx
      .select()
      .from(gramWithdrawals)
      .where(
        and(
          eq(gramWithdrawals.userId, input.userId),
          eq(gramWithdrawals.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    const replay = existingKey[0];
    if (replay) {
      return {
        withdrawal: serializeWithdrawal(
          replay,
          await loadPublicId(tx, input.userId),
        ),
        replayed: true,
      };
    }

    const active = await tx
      .select()
      .from(gramWithdrawals)
      .where(
        and(
          eq(gramWithdrawals.userId, input.userId),
          inArray(gramWithdrawals.status, [...ACTIVE_STATUSES]),
        ),
      )
      .for("update")
      .limit(1);
    if (active[0]) {
      throw new GramWithdrawalAlreadyActiveError();
    }

    const available = gramAvailableMinor(
      asBigInt(balance.amountMinor),
      asBigInt(balance.reservedMinor),
    );
    if (available < GRAM_MIN_WITHDRAWAL_MINOR) {
      throw new GramWithdrawalMinimumError();
    }

    let inserted: typeof gramWithdrawals.$inferSelect;
    try {
      const rows = await tx
        .insert(gramWithdrawals)
        .values({
          userId: input.userId,
          amountMinor: available,
          telegramUsername: username,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("failed to create gram withdrawal");
      }
      inserted = row;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await tx
        .select()
        .from(gramWithdrawals)
        .where(
          and(
            eq(gramWithdrawals.userId, input.userId),
            eq(gramWithdrawals.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (raced[0]) {
        return {
          withdrawal: serializeWithdrawal(
            raced[0],
            await loadPublicId(tx, input.userId),
          ),
          replayed: true,
        };
      }
      throw new GramWithdrawalAlreadyActiveError();
    }

    const nextReserved = asBigInt(balance.reservedMinor) + available;
    await tx
      .update(gramBalances)
      .set({
        reservedMinor: nextReserved,
        updatedAt: new Date(),
      })
      .where(eq(gramBalances.userId, input.userId));

    await insertInbox(tx, {
      userId: input.userId,
      type: "gram_withdrawal_created",
      title: "Заявка на вывод Gram создана",
      body: `Зарезервировано ${formatGramMinor(available)} Gram`,
      withdrawalId: inserted.id,
    });

    return {
      withdrawal: serializeWithdrawal(
        inserted,
        await loadPublicId(tx, input.userId),
      ),
      replayed: false,
    };
  });
}

export async function markGramWithdrawalProcessing(
  db: GiftbotDb,
  input: {
    withdrawalId: string;
    adminUserId: string;
    idempotencyKey: string;
  },
): Promise<{ withdrawal: GramWithdrawalRecord; auditId?: string; replayed: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  return db.transaction(async (tx) => {
    const current = await lockWithdrawal(tx, input.withdrawalId);
    if (current.status === "processing") {
      return {
        withdrawal: serializeWithdrawal(
          current,
          await loadPublicId(tx, current.userId),
        ),
        replayed: true,
      };
    }
    assertTransition(
      "gram_withdrawal",
      gramWithdrawalTransitions,
      current.status,
      "processing",
    );
    const now = new Date();
    const updated = await tx
      .update(gramWithdrawals)
      .set({
        status: "processing",
        processingAt: now,
        updatedAt: now,
        processedByAdminId: input.adminUserId,
      })
      .where(eq(gramWithdrawals.id, current.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to mark gram withdrawal processing");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "gram_withdrawal.processing",
      targetType: "gram_withdrawal",
      targetId: next.id,
      reason: "mark gram withdrawal processing",
      before: { status: current.status },
      after: {
        status: next.status,
        amountMinor: asBigInt(next.amountMinor).toString(),
        idempotencyKey: input.idempotencyKey,
      },
    });
    return {
      withdrawal: serializeWithdrawal(
        next,
        await loadPublicId(tx, next.userId),
      ),
      auditId,
      replayed: false,
    };
  });
}

export async function fulfillGramWithdrawal(
  db: GiftbotDb,
  input: {
    withdrawalId: string;
    adminUserId: string;
    idempotencyKey: string;
  },
): Promise<{ withdrawal: GramWithdrawalRecord; auditId?: string; replayed: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  return db.transaction(async (tx) => {
    const preview = await peekWithdrawal(tx, input.withdrawalId);
    if (preview.status === "fulfilled") {
      return {
        withdrawal: serializeWithdrawal(
          preview,
          await loadPublicId(tx, preview.userId),
        ),
        replayed: true,
      };
    }
    await lockGramBalance(tx, preview.userId);
    const current = await lockWithdrawal(tx, input.withdrawalId);
    if (current.status === "fulfilled") {
      return {
        withdrawal: serializeWithdrawal(
          current,
          await loadPublicId(tx, current.userId),
        ),
        replayed: true,
      };
    }
    assertTransition(
      "gram_withdrawal",
      gramWithdrawalTransitions,
      current.status,
      "fulfilled",
    );
    const balance = await lockGramBalance(tx, current.userId);
    const amount = asBigInt(current.amountMinor);
    const nextBalance = asBigInt(balance.amountMinor) - amount;
    const nextReserved = asBigInt(balance.reservedMinor) - amount;
    if (nextBalance < 0n || nextReserved < 0n) {
      throw new Error("gram reservation is inconsistent");
    }
    await tx
      .update(gramBalances)
      .set({
        amountMinor: nextBalance,
        reservedMinor: nextReserved,
        updatedAt: new Date(),
      })
      .where(eq(gramBalances.userId, current.userId));
    const now = new Date();
    const updated = await tx
      .update(gramWithdrawals)
      .set({
        status: "fulfilled",
        fulfilledAt: now,
        updatedAt: now,
        processedByAdminId: input.adminUserId,
      })
      .where(eq(gramWithdrawals.id, current.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to fulfill gram withdrawal");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "gram_withdrawal.fulfilled",
      targetType: "gram_withdrawal",
      targetId: next.id,
      reason: "fulfill gram withdrawal",
      before: {
        status: current.status,
        amountMinor: amount.toString(),
        balanceMinor: asBigInt(balance.amountMinor).toString(),
        reservedMinor: asBigInt(balance.reservedMinor).toString(),
      },
      after: {
        status: next.status,
        balanceMinor: nextBalance.toString(),
        reservedMinor: nextReserved.toString(),
        idempotencyKey: input.idempotencyKey,
      },
    });
    await insertInbox(tx, {
      userId: current.userId,
      type: "gram_withdrawal_fulfilled",
      title: "Вывод Gram выполнен",
      body: `${formatGramMinor(amount)} Gram обработано`,
      withdrawalId: next.id,
    });
    return {
      withdrawal: serializeWithdrawal(
        next,
        await loadPublicId(tx, next.userId),
      ),
      auditId,
      replayed: false,
    };
  });
}

export async function rejectGramWithdrawal(
  db: GiftbotDb,
  input: {
    withdrawalId: string;
    adminUserId: string;
    reason: unknown;
    idempotencyKey: string;
  },
): Promise<{ withdrawal: GramWithdrawalRecord; auditId?: string; replayed: boolean }> {
  if (!input.idempotencyKey.trim()) {
    throw new Error("idempotency key is required");
  }
  const reason = parseRejectionReason(input.reason);
  return db.transaction(async (tx) => {
    const preview = await peekWithdrawal(tx, input.withdrawalId);
    if (preview.status === "rejected") {
      return {
        withdrawal: serializeWithdrawal(
          preview,
          await loadPublicId(tx, preview.userId),
        ),
        replayed: true,
      };
    }
    await lockGramBalance(tx, preview.userId);
    const current = await lockWithdrawal(tx, input.withdrawalId);
    if (current.status === "rejected") {
      return {
        withdrawal: serializeWithdrawal(
          current,
          await loadPublicId(tx, current.userId),
        ),
        replayed: true,
      };
    }
    assertTransition(
      "gram_withdrawal",
      gramWithdrawalTransitions,
      current.status,
      "rejected",
    );
    const balance = await lockGramBalance(tx, current.userId);
    const amount = asBigInt(current.amountMinor);
    const nextReserved = asBigInt(balance.reservedMinor) - amount;
    if (nextReserved < 0n) {
      throw new Error("gram reservation is inconsistent");
    }
    await tx
      .update(gramBalances)
      .set({
        reservedMinor: nextReserved,
        updatedAt: new Date(),
      })
      .where(eq(gramBalances.userId, current.userId));
    const now = new Date();
    const updated = await tx
      .update(gramWithdrawals)
      .set({
        status: "rejected",
        rejectionReason: reason,
        rejectedAt: now,
        updatedAt: now,
        processedByAdminId: input.adminUserId,
      })
      .where(eq(gramWithdrawals.id, current.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to reject gram withdrawal");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "gram_withdrawal.rejected",
      targetType: "gram_withdrawal",
      targetId: next.id,
      reason,
      before: {
        status: current.status,
        amountMinor: amount.toString(),
        reservedMinor: asBigInt(balance.reservedMinor).toString(),
      },
      after: {
        status: next.status,
        reservedMinor: nextReserved.toString(),
        idempotencyKey: input.idempotencyKey,
      },
    });
    await insertInbox(tx, {
      userId: current.userId,
      type: "gram_withdrawal_rejected",
      title: "Вывод Gram отклонён",
      body: reason,
      withdrawalId: next.id,
    });
    return {
      withdrawal: serializeWithdrawal(
        next,
        await loadPublicId(tx, next.userId),
      ),
      auditId,
      replayed: false,
    };
  });
}

export async function listUserGramWithdrawals(
  db: GiftbotDb,
  input: { userId: string; limit?: number; cursor?: ProfileListCursor },
): Promise<{ items: GramWithdrawalRecord[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const cursor = input.cursor;
  const cursorFilter = cursor
    ? or(
        lt(gramWithdrawals.createdAt, new Date(cursor.createdAt)),
        and(
          eq(gramWithdrawals.createdAt, new Date(cursor.createdAt)),
          lt(gramWithdrawals.id, cursor.id),
        ),
      )
    : undefined;
  const filtered = cursorFilter
    ? db
        .select()
        .from(gramWithdrawals)
        .where(and(eq(gramWithdrawals.userId, input.userId), cursorFilter))
    : db
        .select()
        .from(gramWithdrawals)
        .where(eq(gramWithdrawals.userId, input.userId));
  const rows = await filtered
    .orderBy(desc(gramWithdrawals.createdAt), desc(gramWithdrawals.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const extra = rows[limit];
  return {
    items: page.map((row) => serializeWithdrawal(row, null)),
    nextCursor: extra
      ? encodeProfileCursor({
          createdAt: extra.createdAt.toISOString(),
          id: extra.id,
        })
      : null,
  };
}

export async function listAdminGramWithdrawals(
  db: GiftbotDb,
  input: {
    limit?: number;
    cursor?: ProfileListCursor;
    status?: GramWithdrawalStatus | "all";
  } = {},
): Promise<{ items: GramWithdrawalRecord[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const cursor = input.cursor;
  const status =
    input.status && input.status !== "all" ? input.status : undefined;
  const cursorFilter = cursor
    ? or(
        lt(gramWithdrawals.createdAt, new Date(cursor.createdAt)),
        and(
          eq(gramWithdrawals.createdAt, new Date(cursor.createdAt)),
          lt(gramWithdrawals.id, cursor.id),
        ),
      )
    : undefined;
  const filters = [
    ...(status ? [eq(gramWithdrawals.status, status)] : []),
    ...(cursorFilter ? [cursorFilter] : []),
  ];
  const rows = await db
    .select({
      withdrawal: gramWithdrawals,
      publicId: users.publicId,
    })
    .from(gramWithdrawals)
    .innerJoin(users, eq(users.id, gramWithdrawals.userId))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(gramWithdrawals.createdAt), desc(gramWithdrawals.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const extra = rows[limit];
  return {
    items: page.map((row) =>
      serializeWithdrawal(row.withdrawal, row.publicId),
    ),
    nextCursor: extra
      ? encodeProfileCursor({
          createdAt: extra.withdrawal.createdAt.toISOString(),
          id: extra.withdrawal.id,
        })
      : null,
  };
}
