import {
  giveawayEntries,
  giveawayWinners,
  giveaways,
  jobs,
  kickAccounts,
  notifications,
  telegramAccounts,
  users,
  wallets,
} from "@giftbot/db/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { createTtlCache } from "./read-cache.js";
import { writeAuditIn } from "./admin.js";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  ConflictError,
  DomainError,
  NotFoundError,
} from "./errors.js";
import { GIVEAWAY_IMAGE_URL_RE } from "./file-storage.js";
import { asBigInt } from "./money.js";
import {
  clampProfileListLimit,
  encodeProfileCursor,
  type ProfileListCursor,
} from "./profile-read.js";
import { recordDraw } from "./rng.js";
import { assertTransition, giveawayTransitions } from "./states.js";
import { applyIn } from "./wallet.js";

export type GiveawayDbStatus =
  | "draft"
  | "open"
  | "closed"
  | "settled"
  | "cancelled";

export type GiveawayPublicStatus =
  | "draft"
  | "active"
  | "drawing"
  | "completed"
  | "cancelled";

export type GiveawayType = "coins" | "custom_prize";
export type GiveawayEligibility = "linked_kick";

export type GiveawayWinnerPublic = {
  userId: string;
  publicId: string;
  prizeAzc: string | null;
  prizeText: string | null;
  deliveryStatus: string | null;
};

export type GiveawayPublicDto = {
  id: string;
  title: string;
  type: GiveawayType;
  status: GiveawayPublicStatus;
  bankAzc: string | null;
  customPrize: string | null;
  winnerCount: number;
  actualWinnerCount: number | null;
  eligibility: GiveawayEligibility;
  endsAt: string | null;
  participantCount: number;
  joined: boolean;
  eligible: boolean;
  winners: GiveawayWinnerPublic[] | null;
  serverTime: string;
  imageUrl: string | null;
};

export type GiveawayAdminListItem = {
  id: string;
  title: string;
  type: GiveawayType;
  status: GiveawayDbStatus;
  publicStatus: GiveawayPublicStatus;
  bankAzc: string | null;
  customPrize: string | null;
  winnerCount: number;
  actualWinnerCount: number | null;
  eligibility: GiveawayEligibility;
  endsAt: string | null;
  participantCount: number;
  createdAt: string;
  activatedAt: string | null;
  drawnAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  imageUrl: string | null;
};

export type GiveawayParticipantAdmin = {
  entryId: string;
  userId: string;
  publicId: string;
  status: string;
  createdAt: string;
  isWinner: boolean;
};

const GIVEAWAY_DRAW_JOB = "giveaway.draw";
const ELIGIBILITY_LINKED_KICK: GiveawayEligibility = "linked_kick";

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
    if (
      typeof current !== "object" ||
      current === null ||
      !("cause" in current)
    ) {
      return false;
    }
    current = (current as { cause: unknown }).cause;
  }
  return false;
}

function parseGiveawayImageUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !GIVEAWAY_IMAGE_URL_RE.test(value)) {
    throw new DomainError("BAD_REQUEST", "invalid giveaway imageUrl");
  }
  return value;
}

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new ConflictError("reason is required", "BAD_REQUEST");
  }
  return trimmed;
}

export function toPublicStatus(status: string): GiveawayPublicStatus {
  switch (status) {
    case "open":
      return "active";
    case "closed":
      return "drawing";
    case "settled":
      return "completed";
    case "draft":
      return "draft";
    case "cancelled":
      return "cancelled";
    default:
      throw new DomainError(
        "GIVEAWAY_INVALID_STATE",
        `unknown giveaway status: ${status}`,
      );
  }
}

function parsePositiveWinnerCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new DomainError(
      "GIVEAWAY_INVALID_BANK",
      "winnerCount must be a positive integer",
    );
  }
  return raw;
}

function parseCoinsBank(raw: unknown): bigint {
  let value: bigint;
  try {
    value = asBigInt(raw as bigint | string | number);
  } catch {
    throw new DomainError("GIVEAWAY_INVALID_BANK", "bankAzc is invalid");
  }
  if (value <= 0n) {
    throw new DomainError("GIVEAWAY_INVALID_BANK", "bankAzc must be positive");
  }
  return value;
}

function validateCoinsBank(bankAzc: bigint, winnerCount: number): bigint {
  if (winnerCount <= 0) {
    throw new DomainError(
      "GIVEAWAY_INVALID_BANK",
      "winnerCount must be positive",
    );
  }
  if (bankAzc % BigInt(winnerCount) !== 0n) {
    throw new DomainError(
      "GIVEAWAY_INVALID_BANK",
      "bankAzc must be divisible by winnerCount",
    );
  }
  return bankAzc / BigInt(winnerCount);
}

function parseCustomPrize(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new DomainError("GIVEAWAY_INVALID_BANK", "customPrize is required");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new DomainError(
      "GIVEAWAY_INVALID_BANK",
      "customPrize must be non-empty",
    );
  }
  return trimmed;
}

function parseTitle(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new DomainError("GIVEAWAY_INVALID_STATE", "title is required");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new DomainError("GIVEAWAY_INVALID_STATE", "title is required");
  }
  return trimmed;
}

function parseEndsAt(raw: unknown): Date {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw;
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  throw new DomainError("GIVEAWAY_INVALID_STATE", "endsAt is invalid");
}

function assertType(raw: unknown): GiveawayType {
  if (raw === "coins" || raw === "custom_prize") {
    return raw;
  }
  throw new DomainError(
    "GIVEAWAY_INVALID_STATE",
    "type must be coins or custom_prize",
  );
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

async function insertInbox(
  tx: GiftbotTx,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
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
    payload: input.payload,
  });
}

async function enqueueTelegramNotice(
  tx: GiftbotTx,
  input: { userId: string; idempotencyKey: string; text: string },
): Promise<void> {
  const rows = await tx
    .select({ telegramUserId: telegramAccounts.telegramUserId })
    .from(telegramAccounts)
    .where(
      and(
        eq(telegramAccounts.userId, input.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .limit(1);
  const chatId = rows[0]?.telegramUserId;
  if (chatId === undefined || chatId === null) {
    return;
  }
  await tx
    .insert(jobs)
    .values({
      type: "telegram.send_message",
      owner: "bot",
      payload: { chat_id: Number(chatId), text: input.text },
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] });
}

async function hasActiveKick(
  tx: GiftbotDb | GiftbotTx,
  userId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: kickAccounts.id })
    .from(kickAccounts)
    .where(
      and(eq(kickAccounts.userId, userId), eq(kickAccounts.status, "active")),
    )
    .limit(1);
  return Boolean(rows[0]);
}

async function loadGiveawayForUpdate(
  tx: GiftbotTx,
  giveawayId: string,
): Promise<typeof giveaways.$inferSelect> {
  const rows = await tx
    .select()
    .from(giveaways)
    .where(eq(giveaways.id, giveawayId))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError("giveaway not found", "GIVEAWAY_NOT_FOUND");
  }
  return row;
}

async function countParticipants(
  db: GiftbotDb | GiftbotTx,
  giveawayId: string,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(giveawayEntries)
    .where(eq(giveawayEntries.giveawayId, giveawayId));
  return Number(rows[0]?.value ?? 0);
}

async function loadPublicWinners(
  db: GiftbotDb | GiftbotTx,
  giveawayId: string,
): Promise<GiveawayWinnerPublic[]> {
  const rows = await db
    .select({
      userId: giveawayWinners.userId,
      publicId: users.publicId,
      prizeAzc: giveawayWinners.prizeAzc,
      prizeText: giveawayWinners.prizeText,
      deliveryStatus: giveawayWinners.deliveryStatus,
    })
    .from(giveawayWinners)
    .innerJoin(users, eq(users.id, giveawayWinners.userId))
    .where(eq(giveawayWinners.giveawayId, giveawayId))
    .orderBy(asc(giveawayWinners.userId));
  return rows.map((row) => ({
    userId: row.userId,
    publicId: row.publicId,
    prizeAzc: row.prizeAzc === null ? null : asBigInt(row.prizeAzc).toString(),
    prizeText: row.prizeText,
    deliveryStatus: row.deliveryStatus,
  }));
}

type SharedGiveawayList = {
  rows: Array<typeof giveaways.$inferSelect>;
  participantCounts: Map<string, number>;
  winnersByGiveaway: Map<string, GiveawayWinnerPublic[]>;
};

const giveawayListCache = {
  active: createTtlCache<SharedGiveawayList>(4_000),
  completed: createTtlCache<SharedGiveawayList>(4_000),
};

export function invalidateGiveawayPublicListCache(): void {
  giveawayListCache.active.invalidate();
  giveawayListCache.completed.invalidate();
}

async function loadSharedGiveawayList(
  db: GiftbotDb,
  tab: "active" | "completed",
): Promise<SharedGiveawayList> {
  return giveawayListCache[tab].get(async () => {
    const statuses =
      tab === "active" ? (["open", "closed"] as const) : (["settled"] as const);
    const rows = await db
      .select()
      .from(giveaways)
      .where(inArray(giveaways.status, [...statuses]))
      .orderBy(desc(giveaways.endsAt), desc(giveaways.createdAt));
    const giveawayIds = rows.map((row) => row.id);
    const participantCounts = new Map<string, number>();
    const winnersByGiveaway = new Map<string, GiveawayWinnerPublic[]>();
    if (giveawayIds.length > 0) {
      const counts = await db
        .select({
          giveawayId: giveawayEntries.giveawayId,
          value: count(),
        })
        .from(giveawayEntries)
        .where(inArray(giveawayEntries.giveawayId, giveawayIds))
        .groupBy(giveawayEntries.giveawayId);
      for (const row of counts) {
        participantCounts.set(row.giveawayId, Number(row.value));
      }
    }
    const settledIds = rows
      .filter((row) => row.status === "settled")
      .map((row) => row.id);
    if (settledIds.length > 0) {
      const winnerRows = await db
        .select({
          giveawayId: giveawayWinners.giveawayId,
          userId: giveawayWinners.userId,
          publicId: users.publicId,
          prizeAzc: giveawayWinners.prizeAzc,
          prizeText: giveawayWinners.prizeText,
          deliveryStatus: giveawayWinners.deliveryStatus,
        })
        .from(giveawayWinners)
        .innerJoin(users, eq(users.id, giveawayWinners.userId))
        .where(inArray(giveawayWinners.giveawayId, settledIds))
        .orderBy(asc(giveawayWinners.giveawayId), asc(giveawayWinners.userId));
      for (const row of winnerRows) {
        const list = winnersByGiveaway.get(row.giveawayId) ?? [];
        list.push({
          userId: row.userId,
          publicId: row.publicId,
          prizeAzc:
            row.prizeAzc === null ? null : asBigInt(row.prizeAzc).toString(),
          prizeText: row.prizeText,
          deliveryStatus: row.deliveryStatus,
        });
        winnersByGiveaway.set(row.giveawayId, list);
      }
    }
    return { rows, participantCounts, winnersByGiveaway };
  });
}

function serializePublic(
  row: typeof giveaways.$inferSelect,
  extras: {
    participantCount: number;
    joined: boolean;
    eligible: boolean;
    winners: GiveawayWinnerPublic[] | null;
    serverTime?: Date;
  },
): GiveawayPublicDto {
  const now = extras.serverTime ?? new Date();
  return {
    id: row.id,
    title: row.title,
    type: row.type as GiveawayType,
    status: toPublicStatus(row.status),
    bankAzc: row.bankAzc === null ? null : asBigInt(row.bankAzc).toString(),
    customPrize: row.customPrize,
    winnerCount: row.winnerCount,
    actualWinnerCount: row.actualWinnerCount,
    eligibility: (row.eligibility as GiveawayEligibility) || ELIGIBILITY_LINKED_KICK,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    participantCount: extras.participantCount,
    joined: extras.joined,
    eligible: extras.eligible,
    winners: row.status === "settled" ? extras.winners : null,
    serverTime: now.toISOString(),
    imageUrl: row.imageUrl ?? null,
  };
}

function serializeAdminListItem(
  row: typeof giveaways.$inferSelect,
  participantCount: number,
): GiveawayAdminListItem {
  return {
    id: row.id,
    title: row.title,
    type: row.type as GiveawayType,
    status: row.status as GiveawayDbStatus,
    publicStatus: toPublicStatus(row.status),
    bankAzc: row.bankAzc === null ? null : asBigInt(row.bankAzc).toString(),
    customPrize: row.customPrize,
    winnerCount: row.winnerCount,
    actualWinnerCount: row.actualWinnerCount,
    eligibility: (row.eligibility as GiveawayEligibility) || ELIGIBILITY_LINKED_KICK,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    participantCount,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
    drawnAt: row.drawnAt ? row.drawnAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    imageUrl: row.imageUrl ?? null,
  };
}

async function enqueueDrawJob(
  tx: GiftbotTx,
  giveawayId: string,
  endsAt: Date,
): Promise<void> {
  await tx
    .insert(jobs)
    .values({
      type: GIVEAWAY_DRAW_JOB,
      owner: "worker",
      payload: { giveaway_id: giveawayId },
      idempotencyKey: `giveaway.draw:${giveawayId}`,
      nextAttemptAt: endsAt,
    })
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] });
}

function winnerNoticeBody(
  giveaway: typeof giveaways.$inferSelect,
  prizePerWinner: bigint | null,
): { title: string; body: string; text: string } {
  if (giveaway.type === "coins" && prizePerWinner !== null) {
    const amount = prizePerWinner.toString();
    return {
      title: "Победа в розыгрыше",
      body: `Вы выиграли ${amount} AZC в «${giveaway.title}»`,
      text: `Победа в розыгрыше! Вы выиграли ${amount} AZC в «${giveaway.title}»`,
    };
  }
  const prize = giveaway.customPrize ?? "приз";
  return {
    title: "Победа в розыгрыше",
    body: `Вы выиграли «${prize}» в «${giveaway.title}». Ожидайте выдачи.`,
    text: `Победа в розыгрыше! Вы выиграли «${prize}» в «${giveaway.title}». Ожидайте выдачи.`,
  };
}

export async function createGiveaway(
  db: GiftbotDb,
  input: {
    title: string;
    type: GiveawayType;
    bankAzc?: bigint | string | number | null;
    customPrize?: string | null;
    winnerCount: number;
    endsAt?: Date | string | number | null;
    eligibility?: GiveawayEligibility;
    adminUserId: string;
    reason: string;
    imageUrl?: string | null;
  },
): Promise<{ giveaway: GiveawayAdminListItem; auditId: string }> {
  const title = parseTitle(input.title);
  const type = assertType(input.type);
  const winnerCount = parsePositiveWinnerCount(input.winnerCount);
  const eligibility = input.eligibility ?? ELIGIBILITY_LINKED_KICK;
  if (eligibility !== ELIGIBILITY_LINKED_KICK) {
    throw new DomainError(
      "GIVEAWAY_INVALID_STATE",
      "eligibility must be linked_kick",
    );
  }
  const reason = requireReason(input.reason);
  const imageUrl = parseGiveawayImageUrl(input.imageUrl);
  const endsAt =
    input.endsAt === undefined || input.endsAt === null
      ? null
      : parseEndsAt(input.endsAt);

  let bankAzc: bigint | null = null;
  let prizePerWinnerAzc: bigint | null = null;
  let customPrize: string | null = null;
  if (type === "coins") {
    bankAzc = parseCoinsBank(input.bankAzc);
    prizePerWinnerAzc = validateCoinsBank(bankAzc, winnerCount);
    customPrize = null;
  } else {
    customPrize = parseCustomPrize(input.customPrize);
    bankAzc = null;
    prizePerWinnerAzc = null;
  }

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(giveaways)
      .values({
        title,
        status: "draft",
        type,
        bankAzc,
        customPrize,
        winnerCount,
        eligibility,
        prizePerWinnerAzc,
        endsAt,
        imageUrl,
        createdBy: input.adminUserId,
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error("failed to create giveaway");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "giveaway.create",
      targetType: "giveaway",
      targetId: row.id,
      reason,
      after: {
        title: row.title,
        type: row.type,
        winnerCount: row.winnerCount,
        bankAzc: bankAzc?.toString() ?? null,
        customPrize,
        imageUrl,
      },
    });
    return {
      giveaway: serializeAdminListItem(row, 0),
      auditId,
    };
  });
}

export async function updateDraftGiveaway(
  db: GiftbotDb,
  input: {
    giveawayId: string;
    title?: string;
    type?: GiveawayType;
    bankAzc?: bigint | string | number | null;
    customPrize?: string | null;
    winnerCount?: number;
    endsAt?: Date | string | number | null;
    imageUrl?: string | null;
    adminUserId: string;
    reason: string;
  },
): Promise<{ giveaway: GiveawayAdminListItem; auditId: string }> {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const row = await loadGiveawayForUpdate(tx, input.giveawayId);
    if (row.status !== "draft") {
      throw new ConflictError(
        "only draft giveaways can be edited",
        "GIVEAWAY_INVALID_STATE",
      );
    }

    const title =
      input.title === undefined ? row.title : parseTitle(input.title);
    const type =
      input.type === undefined ? (row.type as GiveawayType) : assertType(input.type);
    const winnerCount =
      input.winnerCount === undefined
        ? row.winnerCount
        : parsePositiveWinnerCount(input.winnerCount);
    const endsAt =
      input.endsAt === undefined
        ? row.endsAt
        : input.endsAt === null
          ? null
          : parseEndsAt(input.endsAt);
    const imageUrl =
      input.imageUrl === undefined
        ? row.imageUrl ?? null
        : parseGiveawayImageUrl(input.imageUrl);

    let bankAzc: bigint | null;
    let prizePerWinnerAzc: bigint | null;
    let customPrize: string | null;
    if (type === "coins") {
      const bankSource =
        input.bankAzc !== undefined
          ? input.bankAzc
          : row.bankAzc === null
            ? null
            : asBigInt(row.bankAzc);
      bankAzc = parseCoinsBank(bankSource);
      prizePerWinnerAzc = validateCoinsBank(bankAzc, winnerCount);
      customPrize = null;
    } else {
      const prizeSource =
        input.customPrize !== undefined ? input.customPrize : row.customPrize;
      customPrize = parseCustomPrize(prizeSource);
      bankAzc = null;
      prizePerWinnerAzc = null;
    }

    const updated = await tx
      .update(giveaways)
      .set({
        title,
        type,
        bankAzc,
        customPrize,
        winnerCount,
        prizePerWinnerAzc,
        endsAt,
        imageUrl,
        version: sql`${giveaways.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(giveaways.id, row.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to update giveaway");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "giveaway.update_draft",
      targetType: "giveaway",
      targetId: row.id,
      reason,
      before: {
        title: row.title,
        type: row.type,
        winnerCount: row.winnerCount,
        bankAzc: row.bankAzc === null ? null : asBigInt(row.bankAzc).toString(),
        customPrize: row.customPrize,
      },
      after: {
        title: next.title,
        type: next.type,
        winnerCount: next.winnerCount,
        bankAzc: bankAzc?.toString() ?? null,
        customPrize,
      },
    });
    const participantCount = await countParticipants(tx, next.id);
    return {
      giveaway: serializeAdminListItem(next, participantCount),
      auditId,
    };
  });
}

export async function activateGiveaway(
  db: GiftbotDb,
  input: {
    giveawayId: string;
    adminUserId: string;
    reason: string;
  },
): Promise<{ giveaway: GiveawayAdminListItem; auditId: string }> {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const row = await loadGiveawayForUpdate(tx, input.giveawayId);
    if (row.status === "open") {
      const participantCount = await countParticipants(tx, row.id);
      return {
        giveaway: serializeAdminListItem(row, participantCount),
        auditId: "",
      };
    }
    assertTransition("giveaway", giveawayTransitions, row.status, "open");
    if (!row.endsAt) {
      throw new DomainError(
        "GIVEAWAY_INVALID_STATE",
        "endsAt is required to activate",
      );
    }
    if (row.type === "coins") {
      if (row.bankAzc === null || row.prizePerWinnerAzc === null) {
        throw new DomainError("GIVEAWAY_INVALID_BANK", "coins bank is incomplete");
      }
      validateCoinsBank(asBigInt(row.bankAzc), row.winnerCount);
    } else {
      parseCustomPrize(row.customPrize);
    }

    const now = new Date();
    const updated = await tx
      .update(giveaways)
      .set({
        status: "open",
        activatedAt: now,
        startsAt: row.startsAt ?? now,
        version: sql`${giveaways.version} + 1`,
        updatedAt: now,
      })
      .where(eq(giveaways.id, row.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to activate giveaway");
    }
    await enqueueDrawJob(tx, next.id, next.endsAt!);
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "giveaway.activate",
      targetType: "giveaway",
      targetId: row.id,
      reason,
      before: { status: row.status },
      after: {
        status: "open",
        endsAt: next.endsAt!.toISOString(),
        bankAzc:
          next.bankAzc === null ? null : asBigInt(next.bankAzc).toString(),
        customPrize: next.customPrize,
        winnerCount: next.winnerCount,
        prizePerWinnerAzc:
          next.prizePerWinnerAzc === null
            ? null
            : asBigInt(next.prizePerWinnerAzc).toString(),
      },
    });
    return {
      giveaway: serializeAdminListItem(next, 0),
      auditId,
    };
  }).then((result) => {
    invalidateGiveawayPublicListCache();
    return result;
  });
}

export async function cancelGiveaway(
  db: GiftbotDb,
  input: {
    giveawayId: string;
    adminUserId: string;
    reason: string;
  },
): Promise<{ giveaway: GiveawayAdminListItem; auditId: string }> {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const row = await loadGiveawayForUpdate(tx, input.giveawayId);
    if (row.status === "cancelled") {
      const participantCount = await countParticipants(tx, row.id);
      return {
        giveaway: serializeAdminListItem(row, participantCount),
        auditId: "",
      };
    }
    if (row.status !== "draft" && row.status !== "open") {
      throw new ConflictError(
        "giveaway can only be cancelled before draw",
        "GIVEAWAY_INVALID_STATE",
      );
    }
    assertTransition("giveaway", giveawayTransitions, row.status, "cancelled");
    const now = new Date();
    const updated = await tx
      .update(giveaways)
      .set({
        status: "cancelled",
        cancelledAt: now,
        version: sql`${giveaways.version} + 1`,
        updatedAt: now,
      })
      .where(eq(giveaways.id, row.id))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new Error("failed to cancel giveaway");
    }
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "giveaway.cancel",
      targetType: "giveaway",
      targetId: row.id,
      reason,
      before: { status: row.status },
      after: { status: "cancelled" },
    });
    const participantCount = await countParticipants(tx, next.id);
    return {
      giveaway: serializeAdminListItem(next, participantCount),
      auditId,
    };
  }).then((result) => {
    invalidateGiveawayPublicListCache();
    return result;
  });
}

export async function joinGiveaway(
  db: GiftbotDb,
  input: { giveawayId: string; userId: string },
): Promise<{ id: string; replayed: boolean }> {
  const result = await db.transaction(async (tx) => {
    const giveaway = await loadGiveawayForUpdate(tx, input.giveawayId);
    if (giveaway.status !== "open") {
      throw new ConflictError("giveaway is not open", "GIVEAWAY_CLOSED");
    }
    if (giveaway.endsAt && giveaway.endsAt.getTime() <= Date.now()) {
      throw new ConflictError("giveaway has ended", "GIVEAWAY_CLOSED");
    }

    const existing = await tx
      .select()
      .from(giveawayEntries)
      .where(
        and(
          eq(giveawayEntries.giveawayId, input.giveawayId),
          eq(giveawayEntries.userId, input.userId),
        ),
      )
      .limit(1);
    const already = existing[0];
    if (already) {
      return { id: already.id, replayed: true };
    }

    if (!(await hasActiveKick(tx, input.userId))) {
      throw new ConflictError(
        "Kick account must be linked",
        "GIVEAWAY_NOT_ELIGIBLE",
      );
    }

    try {
      const inserted = await tx
        .insert(giveawayEntries)
        .values({
          giveawayId: input.giveawayId,
          userId: input.userId,
        })
        .returning();
      const entry = inserted[0];
      if (!entry) {
        throw new Error("failed to enter giveaway");
      }
      return { id: entry.id, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await tx
        .select()
        .from(giveawayEntries)
        .where(
          and(
            eq(giveawayEntries.giveawayId, input.giveawayId),
            eq(giveawayEntries.userId, input.userId),
          ),
        )
        .limit(1);
      const row = raced[0];
      if (!row) {
        throw error;
      }
      return { id: row.id, replayed: true };
    }
  });
  invalidateGiveawayPublicListCache();
  return result;
}

export async function listGiveawaysForUser(
  db: GiftbotDb,
  input: { userId: string; tab: "active" | "completed" },
): Promise<{ items: GiveawayPublicDto[]; serverTime: string }> {
  const now = new Date();
  const shared = await loadSharedGiveawayList(db, input.tab);
  const eligible = await hasActiveKick(db, input.userId);
  const giveawayIds = shared.rows.map((row) => row.id);
  const joinedIds = new Set<string>();
  if (giveawayIds.length > 0) {
    const joined = await db
      .select({ giveawayId: giveawayEntries.giveawayId })
      .from(giveawayEntries)
      .where(
        and(
          eq(giveawayEntries.userId, input.userId),
          inArray(giveawayEntries.giveawayId, giveawayIds),
        ),
      );
    for (const row of joined) {
      joinedIds.add(row.giveawayId);
    }
  }

  return {
    items: shared.rows.map((row) =>
      serializePublic(row, {
        participantCount: shared.participantCounts.get(row.id) ?? 0,
        joined: joinedIds.has(row.id),
        eligible,
        winners: shared.winnersByGiveaway.get(row.id) ?? [],
        serverTime: now,
      }),
    ),
    serverTime: now.toISOString(),
  };
}

export async function getGiveawayForUser(
  db: GiftbotDb,
  input: { giveawayId: string; userId: string },
): Promise<GiveawayPublicDto> {
  const rows = await db
    .select()
    .from(giveaways)
    .where(eq(giveaways.id, input.giveawayId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError("giveaway not found", "GIVEAWAY_NOT_FOUND");
  }
  if (
    row.status === "draft" ||
    row.status === "cancelled"
  ) {
    throw new NotFoundError("giveaway not found", "GIVEAWAY_NOT_FOUND");
  }
  const now = new Date();
  const participantCount = await countParticipants(db, row.id);
  const joinedRows = await db
    .select({ id: giveawayEntries.id })
    .from(giveawayEntries)
    .where(
      and(
        eq(giveawayEntries.giveawayId, row.id),
        eq(giveawayEntries.userId, input.userId),
      ),
    )
    .limit(1);
  const winners =
    row.status === "settled" ? await loadPublicWinners(db, row.id) : [];
  return serializePublic(row, {
    participantCount,
    joined: Boolean(joinedRows[0]),
    eligible: await hasActiveKick(db, input.userId),
    winners,
    serverTime: now,
  });
}

async function selectWinnersWithoutReplacement(
  tx: GiftbotTx,
  giveawayId: string,
  pool: Array<{ entryId: string; userId: string }>,
  take: number,
): Promise<
  Array<{ entryId: string; userId: string; rngDrawId: string }>
> {
  const remaining = [...pool];
  const selected: Array<{ entryId: string; userId: string; rngDrawId: string }> =
    [];
  for (let i = 0; i < take; i += 1) {
    if (remaining.length === 0) {
      break;
    }
    const { row, value } = await recordDraw(tx, {
      purpose: "giveaway",
      maxExclusive: BigInt(remaining.length),
      referenceType: "giveaway",
      referenceId: giveawayId,
      unbiased: true,
    });
    const index = Number(value);
    const picked = remaining.splice(index, 1)[0];
    if (!picked) {
      throw new Error("failed to pick giveaway winner");
    }
    selected.push({
      entryId: picked.entryId,
      userId: picked.userId,
      rngDrawId: row.id,
    });
  }
  return selected;
}

export async function drawGiveaway(
  db: GiftbotDb,
  giveawayId: string,
): Promise<{
  status: GiveawayDbStatus;
  actualWinnerCount: number;
  noop: boolean;
}> {
  const result = await db.transaction(async (tx) => {
    const giveaway = await loadGiveawayForUpdate(tx, giveawayId);

    if (giveaway.status === "cancelled") {
      return { status: "cancelled" as const, actualWinnerCount: 0, noop: true };
    }
    if (giveaway.status === "settled") {
      return {
        status: "settled" as const,
        actualWinnerCount: giveaway.actualWinnerCount ?? 0,
        noop: true,
      };
    }

    let working = giveaway;
    if (working.status === "open") {
      if (!working.endsAt || working.endsAt.getTime() > Date.now()) {
        throw new ConflictError(
          "giveaway has not ended yet",
          "GIVEAWAY_INVALID_STATE",
        );
      }
      assertTransition("giveaway", giveawayTransitions, "open", "closed");
      const closedAt = new Date();
      const closedRows = await tx
        .update(giveaways)
        .set({
          status: "closed",
          drawnAt: closedAt,
          version: sql`${giveaways.version} + 1`,
          updatedAt: closedAt,
        })
        .where(eq(giveaways.id, working.id))
        .returning();
      working = closedRows[0]!;
    } else if (working.status !== "closed") {
      throw new ConflictError(
        "giveaway cannot be drawn in this state",
        "GIVEAWAY_INVALID_STATE",
      );
    }

    const existingWinners = await tx
      .select({ id: giveawayWinners.id })
      .from(giveawayWinners)
      .where(eq(giveawayWinners.giveawayId, working.id))
      .limit(1);
    if (existingWinners[0]) {
      if (working.status === "closed") {
        assertTransition("giveaway", giveawayTransitions, "closed", "settled");
        const now = new Date();
        await tx
          .update(giveaways)
          .set({
            status: "settled",
            completedAt: now,
            version: sql`${giveaways.version} + 1`,
            updatedAt: now,
          })
          .where(eq(giveaways.id, working.id));
      }
      return {
        status: "settled" as const,
        actualWinnerCount: working.actualWinnerCount ?? 0,
        noop: true,
      };
    }

    const entryRows = await tx
      .select({
        entryId: giveawayEntries.id,
        userId: giveawayEntries.userId,
      })
      .from(giveawayEntries)
      .where(
        and(
          eq(giveawayEntries.giveawayId, working.id),
          eq(giveawayEntries.status, "active"),
        ),
      )
      .orderBy(asc(giveawayEntries.userId));

    const eligiblePool: Array<{ entryId: string; userId: string }> = [];
    for (const entry of entryRows) {
      if (await hasActiveKick(tx, entry.userId)) {
        eligiblePool.push(entry);
      }
    }
    eligiblePool.sort((a, b) => a.userId.localeCompare(b.userId));

    const actualWinnerCount = Math.min(working.winnerCount, eligiblePool.length);
    const selected = await selectWinnersWithoutReplacement(
      tx,
      working.id,
      eligiblePool,
      actualWinnerCount,
    );

    const prizePerWinner =
      working.type === "coins" && working.prizePerWinnerAzc !== null
        ? asBigInt(working.prizePerWinnerAzc)
        : null;

    const winnersSorted = [...selected].sort((a, b) =>
      a.userId.localeCompare(b.userId),
    );

    for (const winner of winnersSorted) {
      await ensureWallet(tx, winner.userId);
    }

    for (const winner of winnersSorted) {
      let rewardTransactionId: string | null = null;
      if (working.type === "coins" && prizePerWinner !== null) {
        const paid = await applyIn(tx, {
          userId: winner.userId,
          type: "giveaway_reward",
          amountMinor: prizePerWinner,
          idempotencyKey: `giveaway.reward:${working.id}:${winner.userId}`,
          actorType: "system",
          reason: "Розыгрыш",
          referenceType: "giveaway",
          referenceId: working.id,
          metadata: { entryId: winner.entryId },
        });
        rewardTransactionId = paid.transaction.id;
      }

      await tx.insert(giveawayWinners).values({
        giveawayId: working.id,
        userId: winner.userId,
        entryId: winner.entryId,
        rngDrawId: winner.rngDrawId,
        prizeAzc: working.type === "coins" ? prizePerWinner : null,
        prizeText: working.type === "custom_prize" ? working.customPrize : null,
        deliveryStatus:
          working.type === "custom_prize" ? "pending_delivery" : null,
        rewardTransactionId,
      });

      const notice = winnerNoticeBody(working, prizePerWinner);
      await insertInbox(tx, {
        userId: winner.userId,
        type: "giveaway_win",
        title: notice.title,
        body: notice.body,
        payload: {
          giveawayId: working.id,
          type: working.type,
          prizeAzc: prizePerWinner?.toString() ?? null,
          prizeText: working.customPrize,
        },
      });
      await enqueueTelegramNotice(tx, {
        userId: winner.userId,
        idempotencyKey: `giveaway.win.notify:${working.id}:${winner.userId}`,
        text: notice.text,
      });
    }

    assertTransition("giveaway", giveawayTransitions, "closed", "settled");
    const completedAt = new Date();
    await tx
      .update(giveaways)
      .set({
        status: "settled",
        actualWinnerCount,
        completedAt,
        drawnAt: working.drawnAt ?? completedAt,
        version: sql`${giveaways.version} + 1`,
        updatedAt: completedAt,
      })
      .where(eq(giveaways.id, working.id));

    return {
      status: "settled" as const,
      actualWinnerCount,
      noop: false,
    };
  });
  invalidateGiveawayPublicListCache();
  return result;
}

export async function markCustomPrizeDelivered(
  db: GiftbotDb,
  input: {
    giveawayId: string;
    winnerUserId: string;
    adminUserId: string;
    reason: string;
  },
): Promise<{ winnerId: string; auditId: string; replayed: boolean }> {
  const reason = requireReason(input.reason);
  return db.transaction(async (tx) => {
    const giveaway = await loadGiveawayForUpdate(tx, input.giveawayId);
    if (giveaway.type !== "custom_prize") {
      throw new ConflictError(
        "only custom_prize giveaways have delivery",
        "GIVEAWAY_INVALID_STATE",
      );
    }
    if (giveaway.status !== "settled") {
      throw new ConflictError(
        "giveaway is not settled",
        "GIVEAWAY_INVALID_STATE",
      );
    }
    const winnerRows = await tx
      .select()
      .from(giveawayWinners)
      .where(
        and(
          eq(giveawayWinners.giveawayId, input.giveawayId),
          eq(giveawayWinners.userId, input.winnerUserId),
        ),
      )
      .for("update")
      .limit(1);
    const winner = winnerRows[0];
    if (!winner) {
      throw new NotFoundError("giveaway winner not found", "GIVEAWAY_NOT_FOUND");
    }
    if (winner.deliveryStatus === "delivered") {
      return { winnerId: winner.id, auditId: "", replayed: true };
    }
    if (winner.deliveryStatus !== "pending_delivery") {
      throw new ConflictError(
        "winner is not pending delivery",
        "GIVEAWAY_INVALID_STATE",
      );
    }
    const now = new Date();
    await tx
      .update(giveawayWinners)
      .set({
        deliveryStatus: "delivered",
        deliveredAt: now,
        deliveredBy: input.adminUserId,
      })
      .where(eq(giveawayWinners.id, winner.id));
    const auditId = await writeAuditIn(tx, {
      actorId: input.adminUserId,
      action: "giveaway.mark_delivered",
      targetType: "giveaway_winner",
      targetId: winner.id,
      reason,
      before: { deliveryStatus: winner.deliveryStatus },
      after: { deliveryStatus: "delivered" },
    });
    return { winnerId: winner.id, auditId, replayed: false };
  });
}

export async function listAdminGiveaways(
  db: GiftbotDb,
  input: {
    limit?: number;
    cursor?: ProfileListCursor;
    status?: GiveawayDbStatus | "all";
  } = {},
): Promise<{ items: GiveawayAdminListItem[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const cursor = input.cursor;
  const status =
    input.status && input.status !== "all" ? input.status : undefined;
  const cursorFilter = cursor
    ? or(
        lt(giveaways.createdAt, new Date(cursor.createdAt)),
        and(
          eq(giveaways.createdAt, new Date(cursor.createdAt)),
          lt(giveaways.id, cursor.id),
        ),
      )
    : undefined;
  const rows = await db
    .select()
    .from(giveaways)
    .where(
      and(
        ...(status ? [eq(giveaways.status, status)] : []),
        ...(cursorFilter ? [cursorFilter] : []),
      ),
    )
    .orderBy(desc(giveaways.createdAt), desc(giveaways.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const extra = rows[limit];
  const items: GiveawayAdminListItem[] = [];
  for (const row of page) {
    items.push(
      serializeAdminListItem(row, await countParticipants(db, row.id)),
    );
  }
  return {
    items,
    nextCursor: extra
      ? encodeProfileCursor({
          createdAt: extra.createdAt.toISOString(),
          id: extra.id,
        })
      : null,
  };
}

export async function getAdminGiveawayDetail(
  db: GiftbotDb,
  input: {
    giveawayId: string;
    participantsLimit?: number;
    participantsCursor?: ProfileListCursor;
  },
): Promise<{
  giveaway: GiveawayAdminListItem;
  winners: GiveawayWinnerPublic[];
  participants: GiveawayParticipantAdmin[];
  participantsNextCursor: string | null;
}> {
  const rows = await db
    .select()
    .from(giveaways)
    .where(eq(giveaways.id, input.giveawayId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError("giveaway not found", "GIVEAWAY_NOT_FOUND");
  }
  const participantCount = await countParticipants(db, row.id);
  const winners = await loadPublicWinners(db, row.id);
  const winnerUserIds = new Set(winners.map((w) => w.userId));

  const limit = clampProfileListLimit(input.participantsLimit);
  const cursor = input.participantsCursor;
  const cursorFilter = cursor
    ? or(
        lt(giveawayEntries.createdAt, new Date(cursor.createdAt)),
        and(
          eq(giveawayEntries.createdAt, new Date(cursor.createdAt)),
          lt(giveawayEntries.id, cursor.id),
        ),
      )
    : undefined;
  const entryRows = await db
    .select({
      entryId: giveawayEntries.id,
      userId: giveawayEntries.userId,
      publicId: users.publicId,
      status: giveawayEntries.status,
      createdAt: giveawayEntries.createdAt,
    })
    .from(giveawayEntries)
    .innerJoin(users, eq(users.id, giveawayEntries.userId))
    .where(
      and(
        eq(giveawayEntries.giveawayId, row.id),
        ...(cursorFilter ? [cursorFilter] : []),
      ),
    )
    .orderBy(desc(giveawayEntries.createdAt), desc(giveawayEntries.id))
    .limit(limit + 1);
  const page = entryRows.slice(0, limit);
  const extra = entryRows[limit];
  return {
    giveaway: serializeAdminListItem(row, participantCount),
    winners,
    participants: page.map((entry) => ({
      entryId: entry.entryId,
      userId: entry.userId,
      publicId: entry.publicId,
      status: entry.status,
      createdAt: entry.createdAt.toISOString(),
      isWinner: winnerUserIds.has(entry.userId),
    })),
    participantsNextCursor: extra
      ? encodeProfileCursor({
          createdAt: extra.createdAt.toISOString(),
          id: extra.entryId,
        })
      : null,
  };
}

/**
 * DEV/tests only: move open giveaway endsAt into the past, then draw.
 * Not for production Worker settle paths.
 */
export async function drawGiveawayNowForDev(
  db: GiftbotDb,
  giveawayId: string,
): Promise<{
  status: GiveawayDbStatus;
  actualWinnerCount: number;
  noop: boolean;
}> {
  await db.transaction(async (tx) => {
    const row = await loadGiveawayForUpdate(tx, giveawayId);
    if (row.status === "open") {
      const past = new Date(Date.now() - 1000);
      await tx
        .update(giveaways)
        .set({
          endsAt: past,
          version: sql`${giveaways.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(giveaways.id, giveawayId));
    }
  });
  return drawGiveaway(db, giveawayId);
}
