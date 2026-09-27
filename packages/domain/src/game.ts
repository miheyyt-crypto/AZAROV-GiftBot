import {
  gameBets,
  gameResults,
  gameRounds,
  games,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import { assertAllowedBet, settleFromCatalog } from "./catalog.js";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { recordDraw } from "./rng.js";
import { assertTransition, gameRoundTransitions } from "./states.js";
import { asBigInt } from "./money.js";
import { applyIn, type WalletApplyResult } from "./wallet.js";

export type GameSettleInput = {
  betAmountMinor: bigint;
  drawValue: bigint;
  config: unknown;
};

export type GameSettleOutput = {
  resultPayload: Record<string, unknown>;
  prizeMinor: bigint;
};

export type GameSettleFn = (input: GameSettleInput) => GameSettleOutput;

export type PlayedRound = {
  roundId: string;
  status: string;
  replayed: boolean;
  betTx?: WalletApplyResult | undefined;
  prizeTx?: WalletApplyResult | undefined;
  resultPayload?: Record<string, unknown> | undefined;
};

async function loadGame(tx: GiftbotTx, gameId: string) {
  const rows = await tx.select().from(games).where(eq(games.id, gameId)).limit(1);
  const game = rows[0];
  if (!game) {
    throw new NotFoundError("game not found");
  }
  if (game.status !== "active") {
    throw new ConflictError("game is not active");
  }
  return game;
}

async function loadRoundByKey(tx: GiftbotTx, idempotencyKey: string) {
  const rows = await tx
    .select()
    .from(gameRounds)
    .where(eq(gameRounds.idempotencyKey, idempotencyKey))
    .limit(1);
  return rows[0];
}

export async function acceptInstantGame(
  db: GiftbotDb,
  input: {
    gameId: string;
    userId: string;
    betAmountMinor: bigint;
    idempotencyKey: string;
    betPayload?: Record<string, unknown>;
    settle: GameSettleFn;
  },
): Promise<PlayedRound> {
  return db.transaction(async (tx) => {
    const existing = await loadRoundByKey(tx, input.idempotencyKey);
    if (existing) {
      return { roundId: existing.id, status: existing.status, replayed: true };
    }

    const game = await loadGame(tx, input.gameId);
    if (game.settlementMode !== "instant") {
      throw new ConflictError("game is not instant");
    }

    const created = await tx
      .insert(gameRounds)
      .values({
        gameId: game.id,
        userId: input.userId,
        status: "created",
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    const round = created[0];
    if (!round) {
      throw new Error("failed to create game round");
    }

    const betTx = await applyIn(tx, {
      userId: input.userId,
      type: "bet",
      amountMinor: -input.betAmountMinor,
      idempotencyKey: `bet:${round.id}`,
      actorType: "user",
      actorId: input.userId,
      referenceType: "game_round",
      referenceId: round.id,
    });

    await tx.insert(gameBets).values({
      roundId: round.id,
      amountMinor: input.betAmountMinor,
      walletTxId: betTx.transaction.id,
      payload: input.betPayload ?? {},
    });

    const draw = await recordDraw(tx, {
      purpose: "game",
      maxExclusive: 1_000_000_000n,
      referenceType: "game_round",
      referenceId: round.id,
    });

    const settled = input.settle({
      betAmountMinor: input.betAmountMinor,
      drawValue: draw.value,
      config: game.config,
    });

    let prizeTx: WalletApplyResult | undefined;
    if (settled.prizeMinor > 0n) {
      prizeTx = await applyIn(tx, {
        userId: input.userId,
        type: "prize",
        amountMinor: settled.prizeMinor,
        idempotencyKey: `prize:${round.id}`,
        actorType: "system",
        referenceType: "game_round",
        referenceId: round.id,
      });
    }

    await tx.insert(gameResults).values({
      roundId: round.id,
      rngDrawId: draw.row.id,
      resultPayload: settled.resultPayload,
      prizeTxId: prizeTx?.transaction.id,
    });

    assertTransition("game_round", gameRoundTransitions, "created", "settled");
    await tx
      .update(gameRounds)
      .set({ status: "settled", settledAt: new Date() })
      .where(eq(gameRounds.id, round.id));

    return {
      roundId: round.id,
      status: "settled",
      replayed: false,
      betTx,
      prizeTx,
      resultPayload: settled.resultPayload,
    };
  });
}

export async function acceptAsyncBet(
  db: GiftbotDb,
  input: {
    gameId: string;
    userId: string;
    betAmountMinor: bigint;
    idempotencyKey: string;
    betPayload?: Record<string, unknown>;
  },
): Promise<PlayedRound> {
  return db.transaction(async (tx) => {
    const existing = await loadRoundByKey(tx, input.idempotencyKey);
    if (existing) {
      return { roundId: existing.id, status: existing.status, replayed: true };
    }

    const game = await loadGame(tx, input.gameId);
    if (game.settlementMode !== "async") {
      throw new ConflictError("game is not async");
    }

    const created = await tx
      .insert(gameRounds)
      .values({
        gameId: game.id,
        userId: input.userId,
        status: "created",
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    const round = created[0];
    if (!round) {
      throw new Error("failed to create game round");
    }

    const betTx = await applyIn(tx, {
      userId: input.userId,
      type: "bet",
      amountMinor: -input.betAmountMinor,
      idempotencyKey: `bet:${round.id}`,
      actorType: "user",
      actorId: input.userId,
      referenceType: "game_round",
      referenceId: round.id,
    });

    await tx.insert(gameBets).values({
      roundId: round.id,
      amountMinor: input.betAmountMinor,
      walletTxId: betTx.transaction.id,
      payload: input.betPayload ?? {},
    });

    assertTransition("game_round", gameRoundTransitions, "created", "pending");
    await tx
      .update(gameRounds)
      .set({ status: "pending" })
      .where(eq(gameRounds.id, round.id));

    return {
      roundId: round.id,
      status: "pending",
      replayed: false,
      betTx,
    };
  });
}

export async function settleAsyncRound(
  db: GiftbotDb,
  input: {
    roundId: string;
    settle: GameSettleFn;
  },
): Promise<PlayedRound> {
  return db.transaction(async (tx) => {
    const rounds = await tx
      .select()
      .from(gameRounds)
      .where(eq(gameRounds.id, input.roundId))
      .for("update");
    const round = rounds[0];
    if (!round) {
      throw new NotFoundError("game round not found");
    }
    if (round.status === "settled") {
      return { roundId: round.id, status: round.status, replayed: true };
    }

    assertTransition("game_round", gameRoundTransitions, round.status, "settled");

    const game = await loadGame(tx, round.gameId);
    const bets = await tx
      .select()
      .from(gameBets)
      .where(eq(gameBets.roundId, round.id))
      .limit(1);
    const bet = bets[0];
    if (!bet) {
      throw new NotFoundError("game bet not found");
    }

    const draw = await recordDraw(tx, {
      purpose: "game",
      maxExclusive: 1_000_000_000n,
      referenceType: "game_round",
      referenceId: round.id,
    });

    const settled = input.settle({
      betAmountMinor: asBigInt(bet.amountMinor),
      drawValue: draw.value,
      config: game.config,
    });

    let prizeTx: WalletApplyResult | undefined;
    if (settled.prizeMinor > 0n) {
      prizeTx = await applyIn(tx, {
        userId: round.userId,
        type: "prize",
        amountMinor: settled.prizeMinor,
        idempotencyKey: `prize:${round.id}`,
        actorType: "system",
        referenceType: "game_round",
        referenceId: round.id,
      });
    }

    await tx.insert(gameResults).values({
      roundId: round.id,
      rngDrawId: draw.row.id,
      resultPayload: settled.resultPayload,
      prizeTxId: prizeTx?.transaction.id,
    });

    await tx
      .update(gameRounds)
      .set({ status: "settled", settledAt: new Date() })
      .where(eq(gameRounds.id, round.id));

    return {
      roundId: round.id,
      status: "settled",
      replayed: false,
      prizeTx,
      resultPayload: settled.resultPayload,
    };
  });
}

export async function playCatalogGame(
  db: GiftbotDb,
  input: {
    gameId: string;
    userId: string;
    betAmountMinor: bigint;
    idempotencyKey: string;
    betPayload?: Record<string, unknown>;
  },
): Promise<PlayedRound> {
  const rows = await db.select().from(games).where(eq(games.id, input.gameId)).limit(1);
  const game = rows[0];
  if (!game) {
    throw new NotFoundError("game not found");
  }
  assertAllowedBet(game.config, input.betAmountMinor);
  if (game.settlementMode === "instant") {
    return acceptInstantGame(db, {
      ...input,
      settle: settleFromCatalog,
    });
  }
  if (game.settlementMode === "async") {
    return acceptAsyncBet(db, input);
  }
  throw new ConflictError("game settlement mode is not supported");
}

export type GameRoundView = {
  roundId: string;
  gameId: string;
  userId: string;
  status: string;
  resultPayload?: Record<string, unknown>;
};

export async function readGameRound(
  db: GiftbotDb,
  input: { roundId: string; userId: string },
): Promise<GameRoundView> {
  const rounds = await db
    .select()
    .from(gameRounds)
    .where(eq(gameRounds.id, input.roundId))
    .limit(1);
  const round = rounds[0];
  if (!round || round.userId !== input.userId) {
    throw new NotFoundError("game round not found");
  }
  const results = await db
    .select()
    .from(gameResults)
    .where(eq(gameResults.roundId, round.id))
    .limit(1);
  const result = results[0];
  return {
    roundId: round.id,
    gameId: round.gameId,
    userId: round.userId,
    status: round.status,
    ...(result
      ? { resultPayload: result.resultPayload as Record<string, unknown> }
      : {}),
  };
}
