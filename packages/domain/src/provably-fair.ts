import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PF_VERSION = "azarov:v1" as const;
export const DICE_RESULT_RANGE = 1_000_000;
export const MINES_CELL_COUNT = 25;

export function generateServerSeed(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function hashServerSeed(serverSeed: string): string {
  return createHash("sha256").update(serverSeed, "utf8").digest("hex");
}

export function assertServerSeedHash(
  serverSeed: string,
  serverSeedHash: string,
): boolean {
  const expected = hashServerSeed(serverSeed);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(serverSeedHash, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

const CLIENT_SEED_RE = /^[\x20-\x7E]{1,128}$/;

export function normalizeClientSeed(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("CLIENT_SEED_INVALID");
  }
  const trimmed = raw.trim();
  if (!CLIENT_SEED_RE.test(trimmed)) {
    throw new Error("CLIENT_SEED_INVALID");
  }
  return trimmed;
}

export function defaultClientSeed(): string {
  return randomBytes(16).toString("hex");
}

/** HMAC-SHA256(key=serverSeed, message) → 32 bytes. */
export function hmacSha256(serverSeed: string, message: string): Buffer {
  return createHmac("sha256", serverSeed).update(message, "utf8").digest();
}

/**
 * Deterministic byte stream via HMAC counters.
 * Message: `${prefix}:stream:${counter}`
 */
export class HmacByteStream {
  private counter = 0;
  private buffer: Uint8Array = new Uint8Array(0);
  private offset = 0;

  constructor(
    private readonly serverSeed: string,
    private readonly prefix: string,
  ) {}

  private refill(): void {
    const block = hmacSha256(
      this.serverSeed,
      `${this.prefix}:stream:${this.counter}`,
    );
    this.counter += 1;
    this.buffer = new Uint8Array(block);
    this.offset = 0;
  }

  nextBytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      if (this.offset >= this.buffer.length) {
        this.refill();
      }
      const take = Math.min(n - filled, this.buffer.length - this.offset);
      out.set(this.buffer.subarray(this.offset, this.offset + take), filled);
      this.offset += take;
      filled += take;
    }
    return out;
  }

  /** Unbiased uniform integer in [0, maxExclusive). */
  nextUniformInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error("maxExclusive must be a positive integer");
    }
    if (maxExclusive === 1) {
      return 0;
    }
    const max = BigInt(maxExclusive);
    const bits = 32;
    const span = 1n << BigInt(bits);
    const limit = span - (span % max);
    for (;;) {
      const bytes = this.nextBytes(4);
      let hex = "";
      for (const b of bytes) {
        hex += b.toString(16).padStart(2, "0");
      }
      const raw = BigInt(`0x${hex}`);
      if (raw < limit) {
        return Number(raw % max);
      }
    }
  }
}

export function minesMessagePrefix(
  clientSeed: string,
  nonce: bigint | number,
  mineCount: number,
): string {
  return `${PF_VERSION}:mines:${clientSeed}:${nonce.toString()}:${mineCount}`;
}

export function diceMessagePrefix(
  clientSeed: string,
  nonce: bigint | number,
): string {
  return `${PF_VERSION}:dice:${clientSeed}:${nonce.toString()}`;
}

/** Deterministic Fisher–Yates; first `mineCount` cells are mines (sorted ascending). */
export function generateMinesBoard(input: {
  serverSeed: string;
  clientSeed: string;
  nonce: bigint | number;
  mineCount: number;
}): number[] {
  const cells = Array.from({ length: MINES_CELL_COUNT }, (_, i) => i);
  const stream = new HmacByteStream(
    input.serverSeed,
    minesMessagePrefix(input.clientSeed, input.nonce, input.mineCount),
  );
  for (let i = MINES_CELL_COUNT - 1; i > 0; i -= 1) {
    const j = stream.nextUniformInt(i + 1);
    const tmp = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = tmp;
  }
  return cells.slice(0, input.mineCount).sort((a, b) => a - b);
}

export function verifyMinesBoard(input: {
  serverSeed: string;
  clientSeed: string;
  nonce: bigint | number;
  mineCount: number;
  minePositions: readonly number[];
}): boolean {
  const expected = generateMinesBoard(input);
  if (expected.length !== input.minePositions.length) {
    return false;
  }
  return expected.every((v, i) => v === input.minePositions[i]);
}

export function deriveDiceRawResult(input: {
  serverSeed: string;
  clientSeed: string;
  nonce: bigint | number;
}): number {
  const stream = new HmacByteStream(
    input.serverSeed,
    diceMessagePrefix(input.clientSeed, input.nonce),
  );
  return stream.nextUniformInt(DICE_RESULT_RANGE);
}

export function diceWinThreshold(chance: number): number {
  if (!Number.isInteger(chance) || chance < 1 || chance > 95) {
    throw new Error("invalid chance");
  }
  return chance * 10_000;
}

export function isDiceWin(rawResult: number, chance: number): boolean {
  return rawResult < diceWinThreshold(chance);
}

export function formatDiceDisplay(rawResult: number): string {
  const whole = Math.floor(rawResult / 10_000);
  const frac = rawResult % 10_000;
  return `${whole}.${String(frac).padStart(4, "0").slice(0, 2)}`;
}

/** Floor(bet * multiplier) using exact decimal string → rational BigInt math. */
export function floorBetTimesMultiplier(
  betAzc: bigint,
  multiplier: string,
): bigint {
  const { numerator, denominator } = parseDecimalMultiplier(multiplier);
  return (betAzc * numerator) / denominator;
}

export function parseDecimalMultiplier(value: string): {
  numerator: bigint;
  denominator: bigint;
} {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`invalid multiplier: ${value}`);
  }
  if (!value.includes(".")) {
    return { numerator: BigInt(value), denominator: 1n };
  }
  const [whole, frac = ""] = value.split(".");
  return {
    numerator: BigInt(`${whole}${frac}`),
    denominator: 10n ** BigInt(frac.length),
  };
}

/** Dice payout: floor(bet * 100 / chance). */
export function dicePayoutAzc(betAzc: bigint, chance: number): bigint {
  if (!Number.isInteger(chance) || chance < 1 || chance > 95) {
    throw new Error("invalid chance");
  }
  return (betAzc * 100n) / BigInt(chance);
}

export function diceMultiplierDisplay(chance: number): string {
  if (!Number.isInteger(chance) || chance < 1 || chance > 95) {
    throw new Error("invalid chance");
  }
  return (100 / chance).toFixed(2);
}

export function verifyDiceRound(input: {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: bigint | number;
  chance: number;
  rawResult: number;
  win: boolean;
}): boolean {
  if (!assertServerSeedHash(input.serverSeed, input.serverSeedHash)) {
    return false;
  }
  const raw = deriveDiceRawResult(input);
  if (raw !== input.rawResult) {
    return false;
  }
  return isDiceWin(raw, input.chance) === input.win;
}

export type RollsSnapshotEntry = {
  participantId: string;
  stake: string;
  clientSeed: string;
};

/** Canonical JSON lines: participantId|stake|clientSeed sorted already by caller order. */
export function serializeRollsSnapshot(
  entries: readonly RollsSnapshotEntry[],
): string {
  return entries
    .map((e) => `${e.participantId}|${e.stake}|${e.clientSeed}`)
    .join("\n");
}

export function hashRollsSnapshot(
  entries: readonly RollsSnapshotEntry[],
): string {
  return createHash("sha256")
    .update(serializeRollsSnapshot(entries), "utf8")
    .digest("hex");
}

export function aggregateRollsClientSeed(
  entries: readonly RollsSnapshotEntry[],
): string {
  return createHash("sha256")
    .update(
      entries.map((e) => e.clientSeed).join("\n"),
      "utf8",
    )
    .digest("hex");
}

export function rollsMessagePrefix(input: {
  roundId: string;
  nonce: bigint | number;
  aggregateClientSeed: string;
  snapshotHash: string;
}): string {
  return `${PF_VERSION}:rolls:${input.roundId}:${input.nonce.toString()}:${input.aggregateClientSeed}:${input.snapshotHash}`;
}

export function deriveRollsWinningTicket(input: {
  serverSeed: string;
  roundId: string;
  nonce: bigint | number;
  aggregateClientSeed: string;
  snapshotHash: string;
  totalPot: bigint;
}): bigint {
  if (input.totalPot <= 0n) {
    throw new Error("totalPot must be positive");
  }
  const stream = new HmacByteStream(
    input.serverSeed,
    rollsMessagePrefix(input),
  );
  // Unbiased over BigInt range via 256-bit rejection against totalPot
  const max = input.totalPot;
  const span = 1n << 256n;
  const limit = span - (span % max);
  for (;;) {
    const bytes = stream.nextBytes(32);
    let hex = "";
    for (const b of bytes) {
      hex += b.toString(16).padStart(2, "0");
    }
    const raw = BigInt(`0x${hex}`);
    if (raw < limit) {
      return raw % max;
    }
  }
}

/** Ordered entries: joined_at ASC, id ASC. Ranges [cursor, cursor+stake). */
export function selectRollsWinner(
  ordered: readonly { participantId: string; stake: bigint }[],
  winningTicket: bigint,
): string {
  let cursor = 0n;
  for (const row of ordered) {
    const next = cursor + row.stake;
    if (winningTicket >= cursor && winningTicket < next) {
      return row.participantId;
    }
    cursor = next;
  }
  throw new Error("winning ticket out of range");
}

export function verifyRollsRound(input: {
  serverSeed: string;
  serverSeedHash: string;
  roundId: string;
  nonce: bigint | number;
  entries: readonly RollsSnapshotEntry[];
  totalPot: bigint;
  winningTicket: bigint;
  winnerParticipantId: string;
}): boolean {
  if (!assertServerSeedHash(input.serverSeed, input.serverSeedHash)) {
    return false;
  }
  const snapshotHash = hashRollsSnapshot(input.entries);
  const aggregateClientSeed = aggregateRollsClientSeed(input.entries);
  const ticket = deriveRollsWinningTicket({
    serverSeed: input.serverSeed,
    roundId: input.roundId,
    nonce: input.nonce,
    aggregateClientSeed,
    snapshotHash,
    totalPot: input.totalPot,
  });
  if (ticket !== input.winningTicket) {
    return false;
  }
  const ordered = input.entries.map((e) => ({
    participantId: e.participantId,
    stake: BigInt(e.stake),
  }));
  return selectRollsWinner(ordered, ticket) === input.winnerParticipantId;
}
