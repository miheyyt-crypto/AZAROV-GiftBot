import {
  adminRoleAssignments,
  adminRoles,
  gramBalances,
  inventoryItems,
  notifications,
  userProgress,
  wallets,
  walletTransactions,
} from "@giftbot/db/schema";
import { and, eq } from "drizzle-orm";
import type { GiftbotDb } from "./db.js";
import { GRAM_MINOR_PER_UNIT } from "./gram.js";
import { asBigInt } from "./money.js";
import {
  createShopOrder,
  markShopOrderProcessing,
  rejectShopOrder,
} from "./shop.js";
import { identifyTelegramUser } from "./telegram-identity.js";
import { apply } from "./wallet.js";

export type DevLocalRole = "user" | "admin";

/** Reserved Telegram ids for local fixtures only — not production identities. */
export const DEV_LOCAL_TELEGRAM = {
  user: 910_000_001n,
  admin: 910_000_002n,
} as const;

const DEV_SEED = {
  azc: 500_000n,
  gramMinor: 25n * GRAM_MINOR_PER_UNIT,
  xp: 1_250n,
  cashRub: 200n,
} as const;

export function devSeedIdempotency(role: DevLocalRole, part: string): string {
  return `dev-local:${role}:${part}`;
}

async function ensureSuperAdminAssignment(
  db: GiftbotDb,
  userId: string,
): Promise<void> {
  const roles = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, "super_admin"))
    .limit(1);
  const role = roles[0];
  if (!role) {
    throw new Error("super_admin role is missing");
  }
  await db
    .insert(adminRoleAssignments)
    .values({ userId, roleId: role.id })
    .onConflictDoNothing({
      target: [adminRoleAssignments.userId, adminRoleAssignments.roleId],
    });
}

async function seedNotifications(db: GiftbotDb, userId: string): Promise<void> {
  const samples = [
    {
      key: "welcome",
      title: "Добро пожаловать",
      body: "Локальный dev-пользователь готов к тестам.",
    },
    {
      key: "balance",
      title: "Баланс пополнен",
      body: "Начислено 500000 AZC для локальной разработки.",
    },
    {
      key: "hint",
      title: "Подсказка",
      body: "Это LOCAL DEV — данные из локальной PostgreSQL.",
    },
  ] as const;
  for (const sample of samples) {
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, `dev_seed_${sample.key}`),
        ),
      )
      .limit(1);
    if (existing[0]) {
      continue;
    }
    await db.insert(notifications).values({
      userId,
      channel: "inbox",
      type: `dev_seed_${sample.key}`,
      status: "sent",
      title: sample.title,
      body: sample.body,
      sentAt: new Date(),
      payload: { source: "dev_local_seed" },
    });
  }
}

async function seedInventory(db: GiftbotDb, userId: string): Promise<void> {
  const freeze = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.itemType, "streak_freeze"),
        eq(inventoryItems.source, "dev_local_seed"),
      ),
    )
    .limit(1);
  if (!freeze[0]) {
    await db.insert(inventoryItems).values({
      userId,
      itemType: "streak_freeze",
      status: "available",
      quantity: 2,
      amountRub: null,
      source: "dev_local_seed",
    });
  }

  const cash = await db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.itemType, "cash_rub"),
        eq(inventoryItems.source, "dev_local_seed"),
      ),
    )
    .limit(1);
  if (!cash[0]) {
    await db.insert(inventoryItems).values({
      userId,
      itemType: "cash_rub",
      status: "available",
      quantity: 1,
      amountRub: DEV_SEED.cashRub,
      source: "dev_local_seed",
    });
  }
}

async function seedShopOrders(
  db: GiftbotDb,
  userId: string,
  adminActorId: string,
): Promise<void> {
  await createShopOrder(db, {
    userId,
    productCode: "streak-freeze",
    submittedData: {},
    idempotencyKey: devSeedIdempotency("user", "order:streak-freeze"),
  });

  const pending = await createShopOrder(db, {
    userId,
    productCode: "welvura-200",
    submittedData: { welvuraId: "dev-welvura-pending" },
    idempotencyKey: devSeedIdempotency("user", "order:welvura-pending"),
  });

  const processing = await createShopOrder(db, {
    userId,
    productCode: "welvura-200",
    submittedData: { welvuraId: "dev-welvura-processing" },
    idempotencyKey: devSeedIdempotency("user", "order:welvura-processing"),
  });
  if (!processing.replayed) {
    await markShopOrderProcessing(db, {
      orderId: processing.orderId,
      adminUserId: adminActorId,
      idempotencyKey: devSeedIdempotency("user", "order:welvura-processing:mark"),
    });
  }

  const rejected = await createShopOrder(db, {
    userId,
    productCode: "welvura-200",
    submittedData: { welvuraId: "dev-welvura-rejected" },
    idempotencyKey: devSeedIdempotency("user", "order:welvura-rejected"),
  });
  if (!rejected.replayed) {
    await rejectShopOrder(db, {
      orderId: rejected.orderId,
      adminUserId: adminActorId,
      reason: "dev seed sample rejection",
      idempotencyKey: devSeedIdempotency("user", "order:welvura-rejected:reject"),
    });
  }

  void pending;
}

/**
 * Idempotent local fixture user + sample data for Mini App UI testing.
 * Wallet credits go through Wallet.apply. Safe to call on every /dev/auth.
 */
export async function ensureDevLocalIdentity(
  db: GiftbotDb,
  role: DevLocalRole,
): Promise<{ userId: string; publicId: string }> {
  const telegramUserId =
    role === "admin" ? DEV_LOCAL_TELEGRAM.admin : DEV_LOCAL_TELEGRAM.user;
  const profile =
    role === "admin"
      ? {
          username: "dev_admin",
          firstName: "Dev",
          lastName: "Admin",
        }
      : {
          username: "dev_user",
          firstName: "Dev",
          lastName: "User",
        };

  const identity = await identifyTelegramUser(db, {
    telegramUserId,
    username: profile.username,
    firstName: profile.firstName,
    lastName: profile.lastName,
    languageCode: "ru",
  });

  if (role === "admin") {
    await ensureSuperAdminAssignment(db, identity.userId);
  }

  await apply(db, {
    userId: identity.userId,
    type: "admin_adjustment",
    amountMinor: DEV_SEED.azc,
    idempotencyKey: devSeedIdempotency(role, "azc"),
    actorType: "system",
    reason: "local dev seed AZC",
    metadata: { source: "dev_local_seed" },
  });

  await apply(db, {
    userId: identity.userId,
    type: "reward",
    amountMinor: 100n,
    idempotencyKey: devSeedIdempotency(role, "ledger:reward"),
    actorType: "system",
    reason: "local dev sample ledger",
    metadata: { source: "dev_local_seed" },
  });

  await db
    .insert(gramBalances)
    .values({
      userId: identity.userId,
      amountMinor: DEV_SEED.gramMinor,
      reservedMinor: 0n,
    })
    .onConflictDoNothing({ target: gramBalances.userId });

  await db
    .insert(userProgress)
    .values({
      userId: identity.userId,
      totalXp: DEV_SEED.xp,
    })
    .onConflictDoNothing({ target: userProgress.userId });

  if (role === "user") {
    const admin = await identifyTelegramUser(db, {
      telegramUserId: DEV_LOCAL_TELEGRAM.admin,
      username: "dev_admin",
      firstName: "Dev",
      lastName: "Admin",
      languageCode: "ru",
    });
    await ensureSuperAdminAssignment(db, admin.userId);
    await seedInventory(db, identity.userId);
    await seedNotifications(db, identity.userId);
    await seedShopOrders(db, identity.userId, admin.userId);
  }

  return { userId: identity.userId, publicId: identity.publicId };
}

export async function readDevSeedBalances(
  db: GiftbotDb,
  userId: string,
): Promise<{ azc: string; gramMinor: string; ledgerCount: number }> {
  const ledger = await db
    .select({ id: walletTransactions.id })
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, userId));
  const grams = await db
    .select()
    .from(gramBalances)
    .where(eq(gramBalances.userId, userId))
    .limit(1);
  const walletRows = await db
    .select({ balanceMinor: wallets.balanceMinor })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return {
    azc: asBigInt(walletRows[0]?.balanceMinor ?? 0n).toString(),
    gramMinor: asBigInt(grams[0]?.amountMinor ?? 0n).toString(),
    ledgerCount: ledger.length,
  };
}
