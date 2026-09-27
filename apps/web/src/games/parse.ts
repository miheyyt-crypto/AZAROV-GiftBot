import type { DiceRound, MinesGame } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("expected string");
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return readString(value);
}

function readNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("expected number");
  }
  return value;
}

function readBool(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("expected boolean");
  }
  return value;
}

export function parseMinesGame(value: unknown): MinesGame {
  const row = asRecord(value);
  if (!row) {
    throw new Error("invalid mines game");
  }
  if (!Array.isArray(row.revealedCells)) {
    throw new Error("invalid revealedCells");
  }
  return {
    gameId: readString(row.gameId),
    status: readString(row.status) as MinesGame["status"],
    betAzc: readString(row.betAzc),
    mineCount: readNumber(row.mineCount),
    revealedCells: row.revealedCells.map((c) => readNumber(c)),
    safePickCount: readNumber(row.safePickCount),
    currentMultiplier: readNullableString(row.currentMultiplier),
    potentialPayoutAzc: readNullableString(row.potentialPayoutAzc),
    payoutAzc: readNullableString(row.payoutAzc),
    serverSeedHash: readString(row.serverSeedHash),
    serverSeed: readNullableString(row.serverSeed),
    clientSeed: readString(row.clientSeed),
    nonce: readString(row.nonce),
    algorithm: readString(row.algorithm),
    minePositions: Array.isArray(row.minePositions)
      ? row.minePositions.map((c) => readNumber(c))
      : null,
    createdAt: readString(row.createdAt),
    resolvedAt: readNullableString(row.resolvedAt),
  };
}

export function parseActiveMines(value: unknown): { game: MinesGame | null } {
  const row = asRecord(value);
  if (!row) {
    throw new Error("invalid active mines");
  }
  if (row.game === null) {
    return { game: null };
  }
  return { game: parseMinesGame(row.game) };
}

export function parseMinesStart(value: unknown): {
  game: MinesGame;
  replayed: boolean;
  newBalanceAzc?: string;
} {
  const row = asRecord(value);
  if (!row) {
    throw new Error("invalid mines start");
  }
  return {
    game: parseMinesGame(row.game),
    replayed: row.replayed === true,
    ...(typeof row.newBalanceAzc === "string"
      ? { newBalanceAzc: row.newBalanceAzc }
      : {}),
  };
}

export function parseMinesReveal(value: unknown): {
  game: MinesGame;
  hitMine: boolean;
  newBalanceAzc?: string;
} {
  const row = asRecord(value);
  if (!row) {
    throw new Error("invalid mines reveal");
  }
  return {
    game: parseMinesGame(row.game),
    hitMine: row.hitMine === true,
    ...(typeof row.newBalanceAzc === "string"
      ? { newBalanceAzc: row.newBalanceAzc }
      : {}),
  };
}

export function parseDiceRound(value: unknown): DiceRound {
  const row = asRecord(value);
  if (!row) {
    throw new Error("invalid dice round");
  }
  return {
    id: readString(row.id),
    betAzc: readString(row.betAzc),
    chance: readNumber(row.chance),
    multiplierDisplay: readString(row.multiplierDisplay),
    rawResult: readNumber(row.rawResult),
    displayResult: readString(row.displayResult),
    win: readBool(row.win),
    payoutAzc: readString(row.payoutAzc),
    serverSeedHash: readString(row.serverSeedHash),
    serverSeed: readString(row.serverSeed),
    clientSeed: readString(row.clientSeed),
    nonce: readString(row.nonce),
    algorithm: readString(row.algorithm),
    createdAt: readString(row.createdAt),
  };
}

export function parseDicePlay(value: unknown): {
  round: DiceRound;
  replayed: boolean;
  newBalanceAzc?: string;
} {
  const row = asRecord(value);
  if (!row) {
    throw new Error("invalid dice play");
  }
  return {
    round: parseDiceRound(row.round),
    replayed: row.replayed === true,
    ...(typeof row.newBalanceAzc === "string"
      ? { newBalanceAzc: row.newBalanceAzc }
      : {}),
  };
}

export function parseDiceHistory(value: unknown): {
  items: DiceRound[];
  nextCursor: string | null;
} {
  const row = asRecord(value);
  if (!row || !Array.isArray(row.items)) {
    throw new Error("invalid dice history");
  }
  return {
    items: row.items.map(parseDiceRound),
    nextCursor: readNullableString(row.nextCursor),
  };
}
