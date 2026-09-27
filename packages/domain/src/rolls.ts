import {
  jobs,
  rollsBetOperations,
  rollsParticipants,
  rollsRounds,
  telegramAccounts,
  users,
  wallets,
} from "@giftbot/db/schema";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  ConflictError,
  DomainError,
  InsufficientFundsError,
  NotFoundError,
} from "./errors.js";
import { asBigInt } from "./money.js";
import { publicAvatarUrl } from "./https-url.js";
import {
  aggregateRollsClientSeed,
  deriveRollsWinningTicket,
  generateServerSeed,
  hashRollsSnapshot,
  hashServerSeed,
  normalizeClientSeed,
  selectRollsWinner,
  type RollsSnapshotEntry,
} from "./provably-fair.js";
import { applyIn } from "./wallet.js";

export const ROLLS_MIN_BET = 100n;
export const ROLLS_MAX_STAKE = 100_000n;
export const ROLLS_MAX_PLAYERS = 1000;
export const ROLLS_COUNTDOWN_MS = 20_000;
export const ROLLS_SPIN_MS = 8_000;
export const ROLLS_NOTIFY_CHANNEL = "rolls_events";

export type RollsStatus = "waiting" | "betting" | "spinning" | "resolved";

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

async function allocateRoundNonce(tx: GiftbotTx): Promise<bigint> {
  const count = await tx
    .select({ c: sql<string>`count(*)::text` })
    .from(rollsRounds);
  return BigInt(count[0]?.c ?? "0");
}

function parseAmount(raw: unknown): bigint {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new DomainError("ROLLS_INVALID_BET", "amount must be positive integer AZC");
    }
    return BigInt(raw);
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const v = BigInt(raw);
    if (v <= 0n) {
      throw new DomainError("ROLLS_INVALID_BET", "amount must be positive integer AZC");
    }
    return v;
  }
  throw new DomainError("ROLLS_INVALID_BET", "amount must be positive integer AZC");
}

async function bumpVersion(
  tx: GiftbotTx,
  roundId: string,
  patch: Record<string, unknown>,
): Promise<typeof rollsRounds.$inferSelect> {
  const updated = await tx
    .update(rollsRounds)
    .set({
      ...patch,
      version: sql`${rollsRounds.version} + 1`,
      updatedAt: new Date(),
    } as never)
    .where(eq(rollsRounds.id, roundId))
    .returning();
  const row = updated[0];
  if (!row) {
    throw new Error("failed to bump rolls round");
  }
  return row;
}

async function createWaitingRoundIn(tx: GiftbotTx): Promise<typeof rollsRounds.$inferSelect> {
  const serverSeed = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const nonce = await allocateRoundNonce(tx);
  const inserted = await tx
    .insert(rollsRounds)
    .values({
      status: "waiting",
      serverSeed,
      serverSeedHash,
      nonce,
      spinDurationMs: ROLLS_SPIN_MS,
    })
    .returning();
  const row = inserted[0];
  if (!row) {
    throw new Error("failed to create rolls round");
  }
  return row;
}

export async function ensureCurrentRollsRound(
  db: GiftbotDb,
): Promise<typeof rollsRounds.$inferSelect> {
  return db.transaction(async (tx) => getOrCreateCurrentRound(tx));
}

async function getOrCreateCurrentRound(
  tx: GiftbotTx,
): Promise<typeof rollsRounds.$inferSelect> {
  const current = await tx
    .select()
    .from(rollsRounds)
    .where(inArray(rollsRounds.status, ["waiting", "betting", "spinning"]))
    .for("update")
    .limit(1);
  if (current[0]) {
    return current[0];
  }
  try {
    return await createWaitingRoundIn(tx);
  } catch (error) {
    const again = await tx
      .select()
      .from(rollsRounds)
      .where(inArray(rollsRounds.status, ["waiting", "betting", "spinning"]))
      .for("update")
      .limit(1);
    if (again[0]) {
      return again[0];
    }
    throw error;
  }
}

async function enqueueLockJob(
  tx: GiftbotTx,
  roundId: string,
  deadline: Date,
): Promise<void> {
  await tx
    .insert(jobs)
    .values({
      type: "rolls.lock_round",
      owner: "worker",
      payload: { round_id: roundId },
      idempotencyKey: `rolls.lock_round:${roundId}`,
      nextAttemptAt: deadline,
    })
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] });
}

async function enqueueFinishSpinJob(
  tx: GiftbotTx,
  roundId: string,
  spinEndsAt: Date,
): Promise<void> {
  await tx
    .insert(jobs)
    .values({
      type: "rolls.finish_spin",
      owner: "worker",
      payload: { round_id: roundId },
      idempotencyKey: `rolls.finish_spin:${roundId}`,
      nextAttemptAt: spinEndsAt,
    })
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] });
}

export async function notifyRollsEvent(
  db: GiftbotDb,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await db.execute(
      sql`SELECT pg_notify(${ROLLS_NOTIFY_CHANNEL}, ${JSON.stringify(payload)})`,
    );
  } catch {
    /* optional fan-out */
  }
}

export type RollsParticipantDto = {
  participantId: string;
  publicId: string;
  displayName: string;
  avatarKey: string | null;
  avatarUrl: string | null;
  stakeAzc: string;
  joinedAt: string;
};

export type RollsRoundDto = {
  roundId: string;
  status: RollsStatus;
  version: string;
  participantCount: number;
  totalPotAzc: string;
  bettingDeadline: string | null;
  bettingStartedAt: string | null;
  spinStartedAt: string | null;
  spinDurationMs: number;
  serverSeedHash: string;
  serverSeed: string | null;
  nonce: string;
  algorithm: string;
  aggregateClientSeed: string | null;
  participantSnapshotHash: string | null;
  winningTicket: string | null;
  winnerParticipantId: string | null;
  winnerUserId: string | null;
  payoutAzc: string | null;
  participants: RollsParticipantDto[];
  createdAt: string;
  resolvedAt: string | null;
};

function chanceString(stake: bigint, pot: bigint): string {
  if (pot <= 0n) {
    return "0.00";
  }
  const bps = (stake * 10000n) / pot;
  const whole = bps / 100n;
  const frac = bps % 100n;
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
}

type RollsParticipantRow = typeof rollsParticipants.$inferSelect & {
  photoUrl: string | null;
};

async function loadParticipants(
  db: GiftbotDb | GiftbotTx,
  roundId: string,
): Promise<RollsParticipantRow[]> {
  const rows = await db
    .select({
      participant: rollsParticipants,
      photoUrl: telegramAccounts.photoUrl,
    })
    .from(rollsParticipants)
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, rollsParticipants.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .where(eq(rollsParticipants.roundId, roundId))
    .orderBy(asc(rollsParticipants.joinedAt), asc(rollsParticipants.id));
  return rows.map((row) => ({
    ...row.participant,
    photoUrl: row.photoUrl ?? null,
  }));
}

function toRoundDto(
  round: typeof rollsRounds.$inferSelect,
  parts: RollsParticipantRow[],
): RollsRoundDto {
  const seedRevealed = round.status === "resolved";
  return {
    roundId: round.id,
    status: round.status as RollsStatus,
    version: asBigInt(round.version).toString(),
    participantCount: round.participantCount,
    totalPotAzc: asBigInt(round.totalPot).toString(),
    bettingDeadline: round.bettingDeadline?.toISOString() ?? null,
    bettingStartedAt: round.bettingStartedAt?.toISOString() ?? null,
    spinStartedAt: round.spinStartedAt?.toISOString() ?? null,
    spinDurationMs: round.spinDurationMs,
    serverSeedHash: round.serverSeedHash,
    serverSeed: seedRevealed ? round.serverSeed : null,
    nonce: asBigInt(round.nonce).toString(),
    algorithm: round.algorithm,
    aggregateClientSeed: round.aggregateClientSeed,
    participantSnapshotHash: round.participantSnapshotHash,
    winningTicket:
      round.winningTicket != null
        ? asBigInt(round.winningTicket).toString()
        : null,
    winnerParticipantId: round.winnerParticipantId,
    winnerUserId: round.winnerUserId,
    payoutAzc:
      round.payoutAzc != null ? asBigInt(round.payoutAzc).toString() : null,
    participants: parts.map((p) => ({
      participantId: p.id,
      publicId: p.publicId,
      displayName: p.displayName,
      avatarKey: p.avatarKey,
      avatarUrl: publicAvatarUrl(p.photoUrl) ?? publicAvatarUrl(p.avatarKey),
      stakeAzc: asBigInt(p.totalStake).toString(),
      joinedAt: p.joinedAt.toISOString(),
    })),
    createdAt: round.createdAt.toISOString(),
    resolvedAt: round.resolvedAt?.toISOString() ?? null,
  };
}

export type RollsBoardWinDto = {
  roundId: string;
  winnerId: string;
  winnerName: string;
  winnerUsername: string | null;
  winnerAvatar: string | null;
  winnerInitials: string;
  amount: string;
  chance: string;
  finishedAt: string | null;
};

export function rollsWinnerInitials(name: string): string {
  const trimmed = name.trim().replace(/^@+/, "");
  return trimmed.slice(0, 1).toUpperCase() || "?";
}

function boardWinFromRow(row: {
  roundId: string;
  winnerId: string;
  winnerName: string;
  username: string | null;
  photoUrl: string | null;
  avatarKey: string | null;
  winnerStake: bigint | number | string | null;
  totalPot: bigint | number | string;
  payoutAzc: bigint | number | string | null;
  finishedAt: Date | null;
}): RollsBoardWinDto {
  const name = row.winnerName.trim() || "Игрок";
  const username = row.username?.replace(/^@+/, "").trim() || null;
  const pot = asBigInt(row.totalPot);
  const stake = asBigInt(row.winnerStake ?? 0n);
  const amount = asBigInt(row.payoutAzc ?? pot);
  return {
    roundId: row.roundId,
    winnerId: row.winnerId,
    winnerName: name,
    winnerUsername: username,
    winnerAvatar:
      publicAvatarUrl(row.photoUrl) ?? publicAvatarUrl(row.avatarKey),
    winnerInitials: rollsWinnerInitials(name),
    amount: amount.toString(),
    chance: chanceString(stake, pot),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

async function loadResolvedBoardWin(
  db: GiftbotDb,
  kind: "previous" | "top",
): Promise<RollsBoardWinDto | null> {
  const order =
    kind === "top"
      ? [desc(rollsRounds.totalPot), desc(rollsRounds.resolvedAt), desc(rollsRounds.id)]
      : [desc(rollsRounds.resolvedAt), desc(rollsRounds.id)];
  const rows = await db
    .select({
      roundId: rollsRounds.id,
      winnerId: rollsRounds.winnerUserId,
      winnerName: rollsParticipants.displayName,
      username: telegramAccounts.username,
      photoUrl: telegramAccounts.photoUrl,
      avatarKey: rollsParticipants.avatarKey,
      winnerStake: rollsParticipants.totalStake,
      totalPot: rollsRounds.totalPot,
      payoutAzc: rollsRounds.payoutAzc,
      finishedAt: rollsRounds.resolvedAt,
    })
    .from(rollsRounds)
    .innerJoin(
      rollsParticipants,
      eq(rollsParticipants.id, rollsRounds.winnerParticipantId),
    )
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, rollsRounds.winnerUserId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .where(
      and(
        eq(rollsRounds.status, "resolved"),
        sql`${rollsRounds.winnerUserId} is not null`,
        sql`${rollsRounds.winnerParticipantId} is not null`,
      ),
    )
    .orderBy(...order)
    .limit(1);
  const row = rows[0];
  if (!row?.winnerId || !row.winnerName) {
    return null;
  }
  return boardWinFromRow({
    roundId: row.roundId,
    winnerId: row.winnerId,
    winnerName: row.winnerName,
    username: row.username,
    photoUrl: row.photoUrl,
    avatarKey: row.avatarKey,
    winnerStake: row.winnerStake,
    totalPot: row.totalPot,
    payoutAzc: row.payoutAzc,
    finishedAt: row.finishedAt,
  });
}

export async function loadRollsBoardWins(db: GiftbotDb): Promise<{
  previous: RollsBoardWinDto | null;
  top: RollsBoardWinDto | null;
}> {
  const [previous, top] = await Promise.all([
    loadResolvedBoardWin(db, "previous"),
    loadResolvedBoardWin(db, "top"),
  ]);
  return { previous, top };
}

export async function readRollsCurrent(
  db: GiftbotDb,
  userId?: string,
): Promise<{
  round: RollsRoundDto;
  serverTime: string;
  you: {
    userId?: string;
    stakeAzc: string;
    chancePercent: string;
    participantId: string | null;
  } | null;
  previous: RollsBoardWinDto | null;
  top: RollsBoardWinDto | null;
}> {
  const current = await db
    .select()
    .from(rollsRounds)
    .where(inArray(rollsRounds.status, ["waiting", "betting", "spinning"]))
    .limit(1);
  const round = current[0];
  if (!round) {
    throw new NotFoundError("rolls round not found", "ROLLS_ROUND_NOT_FOUND");
  }
  const parts = await loadParticipants(db, round.id);
  const dto = toRoundDto(round, parts);
  const board = await loadRollsBoardWins(db);
  let you: {
    userId?: string;
    stakeAzc: string;
    chancePercent: string;
    participantId: string | null;
  } | null = null;
  if (userId) {
    const mine = parts.find((p) => p.userId === userId);
    if (mine) {
      you = {
        userId,
        stakeAzc: asBigInt(mine.totalStake).toString(),
        chancePercent: chanceString(
          asBigInt(mine.totalStake),
          asBigInt(round.totalPot),
        ),
        participantId: mine.id,
      };
    } else {
      you = { userId, stakeAzc: "0", chancePercent: "0.00", participantId: null };
    }
  }
  return {
    round: dto,
    serverTime: new Date().toISOString(),
    you,
    previous: board.previous,
    top: board.top,
  };
}

/** Worker/API boot + deadline recovery (not for GET handlers). */
export async function recoverRollsRounds(db: GiftbotDb): Promise<void> {
  await ensureCurrentRollsRound(db);
  await maybeRecoverExpiredBetting(db);
  await maybePromoteSpinning(db);
}

async function maybeRecoverExpiredBetting(db: GiftbotDb): Promise<void> {
  const expired = await db
    .select({ id: rollsRounds.id })
    .from(rollsRounds)
    .where(
      and(
        eq(rollsRounds.status, "betting"),
        lte(rollsRounds.bettingDeadline, new Date()),
      ),
    )
    .limit(5);
  for (const row of expired) {
    await lockAndSettleRollsRound(db, row.id);
  }
}

async function maybePromoteSpinning(db: GiftbotDb): Promise<void> {
  const spinning = await db
    .select()
    .from(rollsRounds)
    .where(eq(rollsRounds.status, "spinning"))
    .limit(1);
  const row = spinning[0];
  if (!row?.spinStartedAt) {
    return;
  }
  const ends =
    row.spinStartedAt.getTime() + (row.spinDurationMs || ROLLS_SPIN_MS);
  if (Date.now() >= ends) {
    await finishRollsSpin(db, row.id);
  }
}

export async function placeRollsBet(
  db: GiftbotDb,
  input: {
    userId: string;
    amountAzc: unknown;
    clientSeed: unknown;
    idempotencyKey: string;
  },
): Promise<{
  round: RollsRoundDto;
  you: {
    userId: string;
    stakeAzc: string;
    chancePercent: string;
    participantId: string;
  };
  replayed: boolean;
  countdownStarted: boolean;
}> {
  const amount = parseAmount(input.amountAzc);
  let clientSeed: string;
  try {
    clientSeed = normalizeClientSeed(input.clientSeed);
  } catch {
    throw new DomainError("ROLLS_INVALID_CLIENT_SEED", "client seed is invalid");
  }

  const result = await db.transaction(async (tx) => {
    const existingOp = await tx
      .select()
      .from(rollsBetOperations)
      .where(
        and(
          eq(rollsBetOperations.userId, input.userId),
          eq(rollsBetOperations.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existingOp[0]) {
      const round = (
        await tx
          .select()
          .from(rollsRounds)
          .where(eq(rollsRounds.id, existingOp[0]!.roundId))
          .limit(1)
      )[0]!;
      const parts = await loadParticipants(tx, round.id);
      const mine = parts.find((p) => p.userId === input.userId)!;
      return {
        round: toRoundDto(round, parts),
        you: {
          userId: input.userId,
          stakeAzc: asBigInt(mine.totalStake).toString(),
          chancePercent: chanceString(
            asBigInt(mine.totalStake),
            asBigInt(round.totalPot),
          ),
          participantId: mine.id,
        },
        replayed: true,
        countdownStarted: false,
      };
    }

    let round = await getOrCreateCurrentRound(tx);
    const locked = await tx
      .select()
      .from(rollsRounds)
      .where(eq(rollsRounds.id, round.id))
      .for("update")
      .limit(1);
    round = locked[0]!;

    if (round.status !== "waiting" && round.status !== "betting") {
      throw new ConflictError("betting closed", "ROLLS_BETTING_CLOSED");
    }
    if (
      round.status === "betting" &&
      round.bettingDeadline &&
      round.bettingDeadline.getTime() <= Date.now()
    ) {
      throw new ConflictError("betting closed", "ROLLS_BETTING_CLOSED");
    }

    const userRows = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      throw new NotFoundError("user not found");
    }
    const tg = await tx
      .select({ username: telegramAccounts.username })
      .from(telegramAccounts)
      .where(
        and(
          eq(telegramAccounts.userId, input.userId),
          eq(telegramAccounts.isActive, true),
        ),
      )
      .limit(1);
    const displayName =
      user.displayName ||
      (tg[0]?.username ? `@${tg[0].username}` : user.publicId);

    const partRows = await tx
      .select()
      .from(rollsParticipants)
      .where(
        and(
          eq(rollsParticipants.roundId, round.id),
          eq(rollsParticipants.userId, input.userId),
        ),
      )
      .for("update")
      .limit(1);
    let participant = partRows[0];
    const isNew = !participant;

    if (isNew) {
      if (amount < ROLLS_MIN_BET) {
        throw new DomainError(
          "ROLLS_INVALID_BET",
          `first bet must be at least ${ROLLS_MIN_BET.toString()}`,
        );
      }
      if (round.participantCount >= ROLLS_MAX_PLAYERS) {
        throw new ConflictError("round is full", "ROLLS_ROUND_FULL");
      }
      if (amount > ROLLS_MAX_STAKE) {
        throw new ConflictError("stake limit", "ROLLS_STAKE_LIMIT");
      }
    } else {
      const next = asBigInt(participant!.totalStake) + amount;
      if (next > ROLLS_MAX_STAKE) {
        throw new ConflictError("stake limit", "ROLLS_STAKE_LIMIT");
      }
    }

    await ensureWallet(tx, input.userId);
    let betTx;
    try {
      betTx = await applyIn(tx, {
        userId: input.userId,
        type: "rolls_bet",
        amountMinor: -amount,
        idempotencyKey: `rolls.bet:${input.userId}:${input.idempotencyKey}`,
        actorType: "user",
        actorId: input.userId,
        reason: "Ставка Rolls",
        referenceType: "rolls_round",
        referenceId: round.id,
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new ConflictError("insufficient balance", "INSUFFICIENT_BALANCE");
      }
      throw error;
    }

    let countdownStarted = false;
    if (isNew) {
      const inserted = await tx
        .insert(rollsParticipants)
        .values({
          roundId: round.id,
          userId: input.userId,
          publicId: user.publicId,
          displayName,
          totalStake: amount,
          clientSeed,
        })
        .returning();
      participant = inserted[0]!;
      const newCount = round.participantCount + 1;
      const newPot = asBigInt(round.totalPot) + amount;
      const patch: Record<string, unknown> = {
        participantCount: newCount,
        totalPot: newPot,
      };
      if (round.status === "waiting" && newCount >= 2) {
        const deadline = new Date(Date.now() + ROLLS_COUNTDOWN_MS);
        patch.status = "betting";
        patch.bettingStartedAt = new Date();
        patch.bettingDeadline = deadline;
        countdownStarted = true;
        await enqueueLockJob(tx, round.id, deadline);
      }
      round = await bumpVersion(tx, round.id, patch);
    } else {
      const nextStake = asBigInt(participant!.totalStake) + amount;
      await tx
        .update(rollsParticipants)
        .set({ totalStake: nextStake, updatedAt: new Date() })
        .where(eq(rollsParticipants.id, participant!.id));
      round = await bumpVersion(tx, round.id, {
        totalPot: asBigInt(round.totalPot) + amount,
      });
      participant = {
        ...participant!,
        totalStake: nextStake,
      };
    }

    await tx.insert(rollsBetOperations).values({
      roundId: round.id,
      userId: input.userId,
      participantId: participant!.id,
      amountAzc: amount,
      stakeAfter: asBigInt(participant!.totalStake),
      idempotencyKey: input.idempotencyKey,
      betTransactionId: betTx.transaction.id,
    });

    const parts = await loadParticipants(tx, round.id);
    return {
      round: toRoundDto(round, parts),
      you: {
        userId: input.userId,
        stakeAzc: asBigInt(participant!.totalStake).toString(),
        chancePercent: chanceString(
          asBigInt(participant!.totalStake),
          asBigInt(round.totalPot),
        ),
        participantId: participant!.id,
      },
      replayed: false,
      countdownStarted,
    };
  });

  await notifyRollsEvent(db, {
    type: result.countdownStarted ? "countdown_started" : "pot_updated",
    roundId: result.round.roundId,
    version: result.round.version,
  });
  return result;
}

export async function lockAndSettleRollsRound(
  db: GiftbotDb,
  roundId: string,
): Promise<{ settled: boolean; roundId: string }> {
  const outcome = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(rollsRounds)
      .where(eq(rollsRounds.id, roundId))
      .for("update")
      .limit(1);
    const round = rows[0];
    if (!round) {
      return { settled: false, roundId };
    }
    if (round.status === "spinning" || round.status === "resolved") {
      return { settled: true, roundId };
    }
    if (round.status !== "betting") {
      return { settled: false, roundId };
    }
    if (
      !round.bettingDeadline ||
      round.bettingDeadline.getTime() > Date.now()
    ) {
      return { settled: false, roundId };
    }

    const parts = await loadParticipants(tx, round.id);
    if (parts.length < 2) {
      return { settled: false, roundId };
    }
    const totalPot = parts.reduce(
      (s, p) => s + asBigInt(p.totalStake),
      0n,
    );
    const entries: RollsSnapshotEntry[] = parts.map((p) => ({
      participantId: p.id,
      stake: asBigInt(p.totalStake).toString(),
      clientSeed: p.clientSeed,
    }));
    const snapshotHash = hashRollsSnapshot(entries);
    const aggregateClientSeed = aggregateRollsClientSeed(entries);
    const winningTicket = deriveRollsWinningTicket({
      serverSeed: round.serverSeed,
      roundId: round.id,
      nonce: asBigInt(round.nonce),
      aggregateClientSeed,
      snapshotHash,
      totalPot,
    });
    const winnerParticipantId = selectRollsWinner(
      parts.map((p) => ({
        participantId: p.id,
        stake: asBigInt(p.totalStake),
      })),
      winningTicket,
    );
    const winner = parts.find((p) => p.id === winnerParticipantId)!;

    const winTx = await applyIn(tx, {
      userId: winner.userId,
      type: "rolls_win",
      amountMinor: totalPot,
      idempotencyKey: `rolls.win:${round.id}`,
      actorType: "system",
      reason: "Выигрыш Rolls",
      referenceType: "rolls_round",
      referenceId: round.id,
      metadata: {
        winningTicket: winningTicket.toString(),
        participantCount: parts.length,
      },
    });

    const spinStartedAt = new Date();
    const spinEnds = new Date(spinStartedAt.getTime() + ROLLS_SPIN_MS);
    await tx
      .update(rollsRounds)
      .set({
        status: "spinning",
        lockedAt: new Date(),
        spinStartedAt,
        spinDurationMs: ROLLS_SPIN_MS,
        totalPot,
        participantCount: parts.length,
        aggregateClientSeed,
        participantSnapshotHash: snapshotHash,
        participantSnapshot: entries,
        winningTicket,
        winnerUserId: winner.userId,
        winnerParticipantId: winner.id,
        payoutAzc: totalPot,
        winTransactionId: winTx.transaction.id,
        version: sql`${rollsRounds.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(rollsRounds.id, round.id));

    await enqueueFinishSpinJob(tx, round.id, spinEnds);
    return { settled: true, roundId };
  });

  if (outcome.settled) {
    await notifyRollsEvent(db, {
      type: "spin_started",
      roundId,
    });
  }
  return outcome;
}

export async function finishRollsSpin(
  db: GiftbotDb,
  roundId: string,
): Promise<{ finished: boolean }> {
  const result = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(rollsRounds)
      .where(eq(rollsRounds.id, roundId))
      .for("update")
      .limit(1);
    const round = rows[0];
    if (!round) {
      return { finished: false };
    }
    if (round.status === "resolved") {
      return { finished: true };
    }
    if (round.status !== "spinning") {
      return { finished: false };
    }
    await tx
      .update(rollsRounds)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        version: sql`${rollsRounds.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(rollsRounds.id, round.id));
    await createWaitingRoundIn(tx);

    const participants = await tx
      .select({ userId: rollsParticipants.userId })
      .from(rollsParticipants)
      .where(eq(rollsParticipants.roundId, round.id));
    const { evaluateAchievementsIn } = await import("./achievements.js");
    for (const part of participants) {
      await evaluateAchievementsIn(tx, part.userId);
    }

    return { finished: true };
  });
  if (result.finished) {
    await notifyRollsEvent(db, { type: "round_resolved", roundId });
    await notifyRollsEvent(db, { type: "next_round" });
  }
  return result;
}

export async function listRollsHistory(
  db: GiftbotDb,
  input: { userId: string; limit?: number; cursor?: string | null },
): Promise<{
  items: Array<{
    roundId: string;
    ownStakeAzc: string;
    totalPotAzc: string;
    chancePercent: string;
    won: boolean;
    payoutAzc: string;
    participantCount: number;
    resolvedAt: string | null;
    serverSeedHash: string;
    serverSeed: string | null;
  }>;
  nextCursor: string | null;
}> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const mine = await db
    .select({
      part: rollsParticipants,
      round: rollsRounds,
    })
    .from(rollsParticipants)
    .innerJoin(rollsRounds, eq(rollsRounds.id, rollsParticipants.roundId))
    .where(
      and(
        eq(rollsParticipants.userId, input.userId),
        inArray(rollsRounds.status, ["spinning", "resolved"]),
      ),
    )
    .orderBy(desc(rollsRounds.createdAt), desc(rollsRounds.id))
    .limit(limit + 1);

  const page = mine.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(({ part, round }) => {
      const pot = asBigInt(round.totalPot);
      const stake = asBigInt(part.totalStake);
      return {
        roundId: round.id,
        ownStakeAzc: stake.toString(),
        totalPotAzc: pot.toString(),
        chancePercent: chanceString(stake, pot),
        won: round.winnerUserId === input.userId,
        payoutAzc:
          round.winnerUserId === input.userId
            ? asBigInt(round.payoutAzc ?? 0n).toString()
            : "0",
        participantCount: round.participantCount,
        resolvedAt: round.resolvedAt?.toISOString() ?? null,
        serverSeedHash: round.serverSeedHash,
        serverSeed: round.status === "resolved" ? round.serverSeed : null,
      };
    }),
    nextCursor:
      mine.length > limit && last
        ? `${last.round.createdAt.toISOString()}|${last.round.id}`
        : null,
  };
}

export async function getRollsProvablyFair(
  db: GiftbotDb,
  roundId: string,
): Promise<Record<string, unknown>> {
  const rows = await db
    .select()
    .from(rollsRounds)
    .where(eq(rollsRounds.id, roundId))
    .limit(1);
  const round = rows[0];
  if (!round) {
    throw new NotFoundError("rolls round not found", "ROLLS_ROUND_NOT_FOUND");
  }
  const seedRevealed = round.status === "resolved";
  return {
    roundId: round.id,
    algorithm: round.algorithm,
    serverSeedHash: round.serverSeedHash,
    serverSeed: seedRevealed ? round.serverSeed : null,
    nonce: asBigInt(round.nonce).toString(),
    aggregateClientSeed: round.aggregateClientSeed,
    participantSnapshotHash: round.participantSnapshotHash,
    participantSnapshot:
      round.status === "spinning" || seedRevealed
        ? round.participantSnapshot
        : null,
    totalPotAzc: asBigInt(round.totalPot).toString(),
    winningTicket:
      round.winningTicket != null
        ? asBigInt(round.winningTicket).toString()
        : null,
    winnerParticipantId: round.winnerParticipantId,
    status: round.status,
  };
}

export async function listRollsRecentWins(
  db: GiftbotDb,
  input: { limit: number },
): Promise<
  Array<{
    id: string;
    username: string | null;
    displayName: string | null;
    publicId: string | null;
    avatarUrl: string | null;
    title: string;
    payoutAzc: string;
    realChance: string;
    createdAt: string;
  }>
> {
  const rows = await db
    .select({
      round: rollsRounds,
      publicId: users.publicId,
      displayName: users.displayName,
      username: telegramAccounts.username,
      photoUrl: telegramAccounts.photoUrl,
      winnerStake: rollsParticipants.totalStake,
    })
    .from(rollsRounds)
    .innerJoin(users, eq(users.id, rollsRounds.winnerUserId))
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, rollsRounds.winnerUserId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .leftJoin(
      rollsParticipants,
      eq(rollsParticipants.id, rollsRounds.winnerParticipantId),
    )
    .where(
      and(eq(rollsRounds.status, "resolved"), gt(rollsRounds.payoutAzc, 0n)),
    )
    .orderBy(desc(rollsRounds.resolvedAt), desc(rollsRounds.id))
    .limit(input.limit);

  return rows.map((row) => {
    const pot = asBigInt(row.round.totalPot);
    const stake = asBigInt(row.winnerStake ?? 0n);
    return {
      id: row.round.id,
      username: row.username,
      displayName: row.displayName,
      publicId: row.publicId,
      avatarUrl: publicAvatarUrl(row.photoUrl),
      title: `Rolls +${asBigInt(row.round.payoutAzc ?? 0n).toString()} AZC`,
      payoutAzc: asBigInt(row.round.payoutAzc ?? 0n).toString(),
      realChance: chanceString(stake, pot),
      createdAt: (row.round.resolvedAt ?? row.round.createdAt).toISOString(),
    };
  });
}
