import {
  minesGames,
  provablyFairNonces,
  telegramAccounts,
  users,
  wallets,
} from "@giftbot/db/schema";
import { and, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  ConflictError,
  DomainError,
  InsufficientFundsError,
  InvalidAmountError,
  NotFoundError,
} from "./errors.js";
import { publicAvatarUrl } from "./https-url.js";
import {
  MINES_MAX_BET,
  MINES_MIN_BET,
  isSupportedMineCount,
  multiplierForSafePicks,
  safeCellCount,
  type SupportedMineCount,
} from "./mines-catalog.js";
import { asBigInt } from "./money.js";
import {
  floorBetTimesMultiplier,
  generateMinesBoard,
  generateServerSeed,
  hashServerSeed,
  normalizeClientSeed,
} from "./provably-fair.js";
import { applyIn } from "./wallet.js";

export type MinesGameStatus = "active" | "cashed_out" | "lost" | "cleared";

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

async function nextNonce(
  tx: GiftbotTx,
  userId: string,
  game: "mines" | "dice",
): Promise<bigint> {
  await tx
    .insert(provablyFairNonces)
    .values({ userId, game, nextNonce: 0n })
    .onConflictDoNothing();
  const rows = await tx
    .select()
    .from(provablyFairNonces)
    .where(
      and(
        eq(provablyFairNonces.userId, userId),
        eq(provablyFairNonces.game, game),
      ),
    )
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("failed to lock provably_fair_nonces");
  }
  const nonce = asBigInt(row.nextNonce);
  await tx
    .update(provablyFairNonces)
    .set({ nextNonce: nonce + 1n, updatedAt: new Date() })
    .where(
      and(
        eq(provablyFairNonces.userId, userId),
        eq(provablyFairNonces.game, game),
      ),
    );
  return nonce;
}

function parseBet(raw: unknown): bigint {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) {
      throw new InvalidAmountError("bet must be an integer AZC");
    }
    return BigInt(raw);
  }
  if (typeof raw === "string" && /^-?\d+$/.test(raw)) {
    return BigInt(raw);
  }
  throw new InvalidAmountError("bet must be an integer AZC");
}

function assertBetLimits(bet: bigint): void {
  if (bet < MINES_MIN_BET || bet > MINES_MAX_BET) {
    throw new DomainError(
      "MINES_BET_OUT_OF_RANGE",
      `bet must be between ${MINES_MIN_BET.toString()} and ${MINES_MAX_BET.toString()}`,
    );
  }
}

function potentialPayout(
  bet: bigint,
  mineCount: SupportedMineCount,
  safePickCount: number,
): bigint | null {
  const mult = multiplierForSafePicks(mineCount, safePickCount);
  if (!mult) {
    return null;
  }
  return floorBetTimesMultiplier(bet, mult);
}

export type MinesPublicDto = {
  gameId: string;
  status: MinesGameStatus;
  betAzc: string;
  mineCount: number;
  revealedCells: number[];
  safePickCount: number;
  currentMultiplier: string | null;
  potentialPayoutAzc: string | null;
  payoutAzc: string | null;
  serverSeedHash: string;
  serverSeed: string | null;
  clientSeed: string;
  nonce: string;
  algorithm: string;
  minePositions: number[] | null;
  createdAt: string;
  resolvedAt: string | null;
};

function toPublic(
  row: typeof minesGames.$inferSelect,
  opts: { revealMines: boolean },
): MinesPublicDto {
  const mineCount = row.mineCount as SupportedMineCount;
  const bet = asBigInt(row.betAzc);
  const resolved = row.status !== "active";
  const mult =
    row.currentMultiplier ??
    multiplierForSafePicks(mineCount, row.safePickCount);
  const pot =
    row.status === "active" && row.safePickCount > 0
      ? potentialPayout(bet, mineCount, row.safePickCount)
      : null;
  return {
    gameId: row.id,
    status: row.status as MinesGameStatus,
    betAzc: bet.toString(),
    mineCount: row.mineCount,
    revealedCells: [...(row.revealedCells ?? [])],
    safePickCount: row.safePickCount,
    currentMultiplier: mult,
    potentialPayoutAzc: pot?.toString() ?? null,
    payoutAzc: row.payoutAzc != null ? asBigInt(row.payoutAzc).toString() : null,
    serverSeedHash: row.serverSeedHash,
    serverSeed: resolved ? row.serverSeed : null,
    clientSeed: row.clientSeed,
    nonce: asBigInt(row.nonce).toString(),
    algorithm: row.algorithm,
    minePositions:
      opts.revealMines && resolved ? [...(row.minePositions ?? [])] : null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function getActiveMinesGame(
  db: GiftbotDb,
  userId: string,
): Promise<MinesPublicDto | null> {
  const rows = await db
    .select()
    .from(minesGames)
    .where(and(eq(minesGames.userId, userId), eq(minesGames.status, "active")))
    .limit(1);
  const row = rows[0];
  return row ? toPublic(row, { revealMines: false }) : null;
}

export async function startMinesGame(
  db: GiftbotDb,
  input: {
    userId: string;
    betAzc: unknown;
    mines: unknown;
    clientSeed: unknown;
    idempotencyKey: string;
  },
): Promise<{ game: MinesPublicDto; replayed: boolean }> {
  const bet = parseBet(input.betAzc);
  assertBetLimits(bet);
  if (typeof input.mines !== "number" || !isSupportedMineCount(input.mines)) {
    throw new DomainError("MINES_INVALID_MINE_COUNT", "unsupported mine count");
  }
  const mineCount = input.mines;
  let clientSeed: string;
  try {
    clientSeed = normalizeClientSeed(input.clientSeed);
  } catch {
    throw new DomainError("CLIENT_SEED_INVALID", "client seed is invalid");
  }

  return db.transaction(async (tx) => {
    const existingByKey = await tx
      .select()
      .from(minesGames)
      .where(
        and(
          eq(minesGames.userId, input.userId),
          eq(minesGames.startIdempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existingByKey[0]) {
      return {
        game: toPublic(existingByKey[0], { revealMines: true }),
        replayed: true,
      };
    }

    const active = await tx
      .select({ id: minesGames.id })
      .from(minesGames)
      .where(
        and(eq(minesGames.userId, input.userId), eq(minesGames.status, "active")),
      )
      .for("update")
      .limit(1);
    if (active[0]) {
      throw new ConflictError(
        "mines game already active",
        "MINES_GAME_ALREADY_ACTIVE",
      );
    }

    await ensureWallet(tx, input.userId);
    const nonce = await nextNonce(tx, input.userId, "mines");
    const serverSeed = generateServerSeed();
    const serverSeedHash = hashServerSeed(serverSeed);
    const minePositions = generateMinesBoard({
      serverSeed,
      clientSeed,
      nonce,
      mineCount,
    });

    let betTx;
    try {
      betTx = await applyIn(tx, {
        userId: input.userId,
        type: "mines_bet",
        amountMinor: -bet,
        idempotencyKey: `mines.bet:${input.userId}:${input.idempotencyKey}`,
        actorType: "user",
        actorId: input.userId,
        reason: "Ставка Mines",
        referenceType: "mines_game",
        metadata: { mineCount },
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new ConflictError("insufficient balance", "INSUFFICIENT_BALANCE");
      }
      throw error;
    }

    try {
      const inserted = await tx
        .insert(minesGames)
        .values({
          userId: input.userId,
          status: "active",
          betAzc: bet,
          mineCount,
          minePositions,
          revealedCells: [],
          safePickCount: 0,
          clientSeed,
          serverSeed,
          serverSeedHash,
          nonce,
          startIdempotencyKey: input.idempotencyKey,
          betTransactionId: betTx.transaction.id,
        })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new Error("failed to create mines game");
      }
      return { game: toPublic(row, { revealMines: false }), replayed: false };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("mines_games_one_active_per_user")) {
        throw new ConflictError(
          "mines game already active",
          "MINES_GAME_ALREADY_ACTIVE",
        );
      }
      if (msg.includes("mines_games_start_idempotency_unique")) {
        const raced = await tx
          .select()
          .from(minesGames)
          .where(
            and(
              eq(minesGames.userId, input.userId),
              eq(minesGames.startIdempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (raced[0]) {
          return {
            game: toPublic(raced[0], { revealMines: true }),
            replayed: true,
          };
        }
      }
      throw error;
    }
  });
}

async function lockOwnedGame(
  tx: GiftbotTx,
  userId: string,
  gameId: string,
): Promise<typeof minesGames.$inferSelect> {
  const rows = await tx
    .select()
    .from(minesGames)
    .where(and(eq(minesGames.id, gameId), eq(minesGames.userId, userId)))
    .for("update")
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError("mines game not found", "MINES_GAME_NOT_FOUND");
  }
  return row;
}

async function payMinesWin(
  tx: GiftbotTx,
  row: typeof minesGames.$inferSelect,
  payout: bigint,
  status: "cashed_out" | "cleared",
): Promise<typeof minesGames.$inferSelect> {
  const winTx = await applyIn(tx, {
    userId: row.userId,
    type: "mines_win",
    amountMinor: payout,
    idempotencyKey: `mines.win:${row.id}`,
    actorType: "system",
    reason: "Выигрыш Mines",
    referenceType: "mines_game",
    referenceId: row.id,
    metadata: {
      multiplier: row.currentMultiplier,
      safePickCount: row.safePickCount,
    },
  });
  const updated = await tx
    .update(minesGames)
    .set({
      status,
      payoutAzc: payout,
      winTransactionId: winTx.transaction.id,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(minesGames.id, row.id))
    .returning();
  return updated[0] ?? row;
}

export async function revealMinesCell(
  db: GiftbotDb,
  input: {
    userId: string;
    gameId: string;
    cell: unknown;
    idempotencyKey: string;
  },
): Promise<{ game: MinesPublicDto; hitMine: boolean }> {
  if (
    typeof input.cell !== "number" ||
    !Number.isInteger(input.cell) ||
    input.cell < 0 ||
    input.cell > 24
  ) {
    throw new DomainError("MINES_INVALID_CELL", "cell must be 0..24");
  }
  const cell = input.cell;

  return db.transaction(async (tx) => {
    const row = await lockOwnedGame(tx, input.userId, input.gameId);
    if (row.status !== "active") {
      return {
        game: toPublic(row, { revealMines: true }),
        hitMine: row.status === "lost",
      };
    }

    const revealed = [...(row.revealedCells ?? [])];
    if (revealed.includes(cell)) {
      return { game: toPublic(row, { revealMines: false }), hitMine: false };
    }

    const mines = new Set(row.minePositions ?? []);
    if (mines.has(cell)) {
      const lost = await tx
        .update(minesGames)
        .set({
          status: "lost",
          payoutAzc: 0n,
          revealedCells: [...revealed, cell],
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(minesGames.id, row.id))
        .returning();
      const { evaluateAchievementsIn } = await import("./achievements.js");
      await evaluateAchievementsIn(tx, input.userId);
      return {
        game: toPublic(lost[0]!, { revealMines: true }),
        hitMine: true,
      };
    }

    const mineCount = row.mineCount as SupportedMineCount;
    const nextSafe = row.safePickCount + 1;
    const mult = multiplierForSafePicks(mineCount, nextSafe);
    if (!mult) {
      throw new Error("missing multiplier for safe pick");
    }
    const nextRevealed = [...revealed, cell];
    const maxSafe = safeCellCount(mineCount);

    if (nextSafe >= maxSafe) {
      const mid = await tx
        .update(minesGames)
        .set({
          revealedCells: nextRevealed,
          safePickCount: nextSafe,
          currentMultiplier: mult,
          updatedAt: new Date(),
        })
        .where(eq(minesGames.id, row.id))
        .returning();
      const payout = floorBetTimesMultiplier(asBigInt(row.betAzc), mult);
      const cleared = await payMinesWin(tx, mid[0]!, payout, "cleared");
      const { evaluateAchievementsIn } = await import("./achievements.js");
      await evaluateAchievementsIn(tx, input.userId);
      return { game: toPublic(cleared, { revealMines: true }), hitMine: false };
    }

    const updated = await tx
      .update(minesGames)
      .set({
        revealedCells: nextRevealed,
        safePickCount: nextSafe,
        currentMultiplier: mult,
        updatedAt: new Date(),
      })
      .where(eq(minesGames.id, row.id))
      .returning();
    return {
      game: toPublic(updated[0]!, { revealMines: false }),
      hitMine: false,
    };
  });
}

export async function cashoutMinesGame(
  db: GiftbotDb,
  input: { userId: string; gameId: string; idempotencyKey: string },
): Promise<{ game: MinesPublicDto; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const row = await lockOwnedGame(tx, input.userId, input.gameId);
    if (row.status === "cashed_out" || row.status === "cleared") {
      return { game: toPublic(row, { revealMines: true }), replayed: true };
    }
    if (row.status !== "active") {
      throw new ConflictError("mines game is not active", "MINES_GAME_NOT_ACTIVE");
    }
    if (row.safePickCount < 1) {
      throw new ConflictError(
        "cashout requires at least one safe pick",
        "MINES_CASHOUT_TOO_EARLY",
      );
    }
    const mineCount = row.mineCount as SupportedMineCount;
    const mult =
      row.currentMultiplier ??
      multiplierForSafePicks(mineCount, row.safePickCount);
    if (!mult) {
      throw new Error("missing multiplier for cashout");
    }
    const payout = floorBetTimesMultiplier(asBigInt(row.betAzc), mult);
    const won = await payMinesWin(
      tx,
      { ...row, currentMultiplier: mult },
      payout,
      "cashed_out",
    );
    const { evaluateAchievementsIn } = await import("./achievements.js");
    await evaluateAchievementsIn(tx, input.userId);
    return { game: toPublic(won, { revealMines: true }), replayed: false };
  });
}

export async function listMinesHistory(
  db: GiftbotDb,
  input: { userId: string; limit?: number; cursor?: string | null },
): Promise<{ items: MinesPublicDto[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  let cursorCreatedAt: Date | undefined;
  let cursorId: string | undefined;
  if (input.cursor) {
    const [ts, id] = input.cursor.split("|");
    if (ts && id) {
      cursorCreatedAt = new Date(ts);
      cursorId = id;
    }
  }
  const rows = await db
    .select()
    .from(minesGames)
    .where(
      and(
        eq(minesGames.userId, input.userId),
        sql`${minesGames.status} <> 'active'`,
        ...(cursorCreatedAt && cursorId
          ? [
              or(
                lt(minesGames.createdAt, cursorCreatedAt),
                and(
                  eq(minesGames.createdAt, cursorCreatedAt),
                  lt(minesGames.id, cursorId),
                ),
              ),
            ]
          : []),
      ),
    )
    .orderBy(desc(minesGames.createdAt), desc(minesGames.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toPublic(row, { revealMines: true })),
    nextCursor:
      rows.length > limit && last
        ? `${last.createdAt.toISOString()}|${last.id}`
        : null,
  };
}

export async function listMinesRecentWins(
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
    createdAt: string;
  }>
> {
  const rows = await db
    .select({
      game: minesGames,
      publicId: users.publicId,
      displayName: users.displayName,
      username: telegramAccounts.username,
      photoUrl: telegramAccounts.photoUrl,
    })
    .from(minesGames)
    .innerJoin(users, eq(users.id, minesGames.userId))
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, minesGames.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .where(
      and(
        inArray(minesGames.status, ["cashed_out", "cleared"]),
        gt(minesGames.payoutAzc, 0n),
      ),
    )
    .orderBy(desc(minesGames.resolvedAt), desc(minesGames.id))
    .limit(input.limit);

  return rows.map((row) => ({
    id: row.game.id,
    username: row.username,
    displayName: row.displayName,
    publicId: row.publicId,
    avatarUrl: publicAvatarUrl(row.photoUrl),
    title: `Mines +${asBigInt(row.game.payoutAzc ?? 0n).toString()} AZC`,
    payoutAzc: asBigInt(row.game.payoutAzc ?? 0n).toString(),
    createdAt: (row.game.resolvedAt ?? row.game.createdAt).toISOString(),
  }));
}
