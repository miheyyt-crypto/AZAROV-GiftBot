import {
  diceRounds,
  provablyFairNonces,
  telegramAccounts,
  users,
  wallets,
} from "@giftbot/db/schema";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import {
  ConflictError,
  DomainError,
  InsufficientFundsError,
  InvalidAmountError,
  NotFoundError,
} from "./errors.js";
import { publicAvatarUrl } from "./https-url.js";
import { asBigInt } from "./money.js";
import {
  deriveDiceRawResult,
  diceMultiplierDisplay,
  dicePayoutAzc,
  formatDiceDisplay,
  generateServerSeed,
  hashServerSeed,
  isDiceWin,
  normalizeClientSeed,
} from "./provably-fair.js";
import { applyIn } from "./wallet.js";

export const DICE_MIN_BET = 100n;
export const DICE_MAX_BET = 10_000n;

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

async function nextNonce(tx: GiftbotTx, userId: string): Promise<bigint> {
  await tx
    .insert(provablyFairNonces)
    .values({ userId, game: "dice", nextNonce: 0n })
    .onConflictDoNothing();
  const rows = await tx
    .select()
    .from(provablyFairNonces)
    .where(
      and(
        eq(provablyFairNonces.userId, userId),
        eq(provablyFairNonces.game, "dice"),
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
        eq(provablyFairNonces.game, "dice"),
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

function parseChance(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new DomainError("DICE_INVALID_CHANCE", "chance must be integer 1..95");
  }
  if (raw < 1 || raw > 95) {
    throw new DomainError("DICE_INVALID_CHANCE", "chance must be integer 1..95");
  }
  return raw;
}

export type DiceRoundDto = {
  id: string;
  betAzc: string;
  chance: number;
  multiplierDisplay: string;
  rawResult: number;
  displayResult: string;
  win: boolean;
  payoutAzc: string;
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: string;
  algorithm: string;
  createdAt: string;
};

function toDto(row: typeof diceRounds.$inferSelect): DiceRoundDto {
  return {
    id: row.id,
    betAzc: asBigInt(row.betAzc).toString(),
    chance: row.chance,
    multiplierDisplay: diceMultiplierDisplay(row.chance),
    rawResult: row.rawResult,
    displayResult: formatDiceDisplay(row.rawResult),
    win: row.win,
    payoutAzc: asBigInt(row.payoutAzc).toString(),
    serverSeedHash: row.serverSeedHash,
    serverSeed: row.serverSeed,
    clientSeed: row.clientSeed,
    nonce: asBigInt(row.nonce).toString(),
    algorithm: row.algorithm,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function playDice(
  db: GiftbotDb,
  input: {
    userId: string;
    betAzc: unknown;
    chance: unknown;
    clientSeed: unknown;
    idempotencyKey: string;
  },
): Promise<{ round: DiceRoundDto; replayed: boolean }> {
  const bet = parseBet(input.betAzc);
  if (bet < DICE_MIN_BET || bet > DICE_MAX_BET) {
    throw new DomainError(
      "DICE_BET_OUT_OF_RANGE",
      `bet must be between ${DICE_MIN_BET.toString()} and ${DICE_MAX_BET.toString()}`,
    );
  }
  const chance = parseChance(input.chance);
  let clientSeed: string;
  try {
    clientSeed = normalizeClientSeed(input.clientSeed);
  } catch {
    throw new DomainError("CLIENT_SEED_INVALID", "client seed is invalid");
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(diceRounds)
      .where(
        and(
          eq(diceRounds.userId, input.userId),
          eq(diceRounds.playIdempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return { round: toDto(existing[0]), replayed: true };
    }

    await ensureWallet(tx, input.userId);
    const nonce = await nextNonce(tx, input.userId);
    const serverSeed = generateServerSeed();
    const serverSeedHash = hashServerSeed(serverSeed);
    const rawResult = deriveDiceRawResult({
      serverSeed,
      clientSeed,
      nonce,
    });
    const win = isDiceWin(rawResult, chance);
    const payout = win ? dicePayoutAzc(bet, chance) : 0n;

    let betTx;
    try {
      betTx = await applyIn(tx, {
        userId: input.userId,
        type: "dice_bet",
        amountMinor: -bet,
        idempotencyKey: `dice.bet:${input.userId}:${input.idempotencyKey}`,
        actorType: "user",
        actorId: input.userId,
        reason: "Ставка Dice",
        referenceType: "dice_round",
        metadata: { chance },
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new ConflictError("insufficient balance", "INSUFFICIENT_BALANCE");
      }
      throw error;
    }

    let winTxId: string | undefined;
    if (win && payout > 0n) {
      const winTx = await applyIn(tx, {
        userId: input.userId,
        type: "dice_win",
        amountMinor: payout,
        idempotencyKey: `dice.win:${input.userId}:${input.idempotencyKey}`,
        actorType: "system",
        reason: "Выигрыш Dice",
        referenceType: "dice_round",
        metadata: { chance, rawResult },
      });
      winTxId = winTx.transaction.id;
    }

    try {
      const inserted = await tx
        .insert(diceRounds)
        .values({
          userId: input.userId,
          betAzc: bet,
          chance,
          rawResult,
          win,
          payoutAzc: payout,
          clientSeed,
          serverSeed,
          serverSeedHash,
          nonce,
          playIdempotencyKey: input.idempotencyKey,
          betTransactionId: betTx.transaction.id,
          ...(winTxId ? { winTransactionId: winTxId } : {}),
        })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new Error("failed to insert dice round");
      }
      const { evaluateAchievementsIn } = await import("./achievements.js");
      await evaluateAchievementsIn(tx, input.userId);
      return { round: toDto(row), replayed: false };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("dice_rounds_play_idempotency_unique")) {
        const raced = await tx
          .select()
          .from(diceRounds)
          .where(
            and(
              eq(diceRounds.userId, input.userId),
              eq(diceRounds.playIdempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (raced[0]) {
          return { round: toDto(raced[0]), replayed: true };
        }
      }
      throw error;
    }
  });
}

export async function listDiceHistory(
  db: GiftbotDb,
  input: { userId: string; limit?: number; cursor?: string | null },
): Promise<{ items: DiceRoundDto[]; nextCursor: string | null }> {
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
    .from(diceRounds)
    .where(
      and(
        eq(diceRounds.userId, input.userId),
        ...(cursorCreatedAt && cursorId
          ? [
              or(
                lt(diceRounds.createdAt, cursorCreatedAt),
                and(
                  eq(diceRounds.createdAt, cursorCreatedAt),
                  lt(diceRounds.id, cursorId),
                ),
              ),
            ]
          : []),
      ),
    )
    .orderBy(desc(diceRounds.createdAt), desc(diceRounds.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toDto),
    nextCursor:
      rows.length > limit && last
        ? `${last.createdAt.toISOString()}|${last.id}`
        : null,
  };
}

export async function getDiceRound(
  db: GiftbotDb,
  input: { userId: string; roundId: string },
): Promise<DiceRoundDto> {
  const rows = await db
    .select()
    .from(diceRounds)
    .where(
      and(eq(diceRounds.id, input.roundId), eq(diceRounds.userId, input.userId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError("dice round not found", "DICE_ROUND_NOT_FOUND");
  }
  return toDto(row);
}

export async function listDiceRecentWins(
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
    chance: number;
    createdAt: string;
  }>
> {
  const rows = await db
    .select({
      round: diceRounds,
      publicId: users.publicId,
      displayName: users.displayName,
      username: telegramAccounts.username,
      photoUrl: telegramAccounts.photoUrl,
    })
    .from(diceRounds)
    .innerJoin(users, eq(users.id, diceRounds.userId))
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, diceRounds.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .where(eq(diceRounds.win, true))
    .orderBy(desc(diceRounds.createdAt), desc(diceRounds.id))
    .limit(input.limit);

  return rows.map((row) => ({
    id: row.round.id,
    username: row.username,
    displayName: row.displayName,
    publicId: row.publicId,
    avatarUrl: publicAvatarUrl(row.photoUrl),
    title: `Dice +${asBigInt(row.round.payoutAzc).toString()} AZC`,
    payoutAzc: asBigInt(row.round.payoutAzc).toString(),
    chance: row.round.chance,
    createdAt: row.round.createdAt.toISOString(),
  }));
}
