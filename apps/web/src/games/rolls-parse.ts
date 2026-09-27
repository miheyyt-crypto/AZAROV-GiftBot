import type {
  RollsBoardWin,
  RollsCurrent,
  RollsHistoryItem,
  RollsParticipant,
  RollsRound,
  RollsStatus,
  RollsYou,
} from "./rolls-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function parseParticipant(value: unknown): RollsParticipant {
  if (!isRecord(value)) {
    throw new Error("invalid rolls participant");
  }
  return {
    participantId: readString(value.participantId),
    publicId: readString(value.publicId),
    displayName: readString(value.displayName),
    avatarKey: readNullableString(value.avatarKey),
    avatarUrl:
      value.avatarUrl === undefined ? null : readNullableString(value.avatarUrl),
    stakeAzc: readString(value.stakeAzc),
    joinedAt: readString(value.joinedAt),
  };
}

function parseStatus(value: unknown): RollsStatus {
  if (
    value === "waiting" ||
    value === "betting" ||
    value === "spinning" ||
    value === "resolved"
  ) {
    return value;
  }
  throw new Error("invalid rolls status");
}

export function parseRollsRound(value: unknown): RollsRound {
  if (!isRecord(value) || !Array.isArray(value.participants)) {
    throw new Error("invalid rolls round");
  }
  return {
    roundId: readString(value.roundId),
    status: parseStatus(value.status),
    version: readString(value.version),
    participantCount: readNumber(value.participantCount),
    totalPotAzc: readString(value.totalPotAzc),
    bettingDeadline: readNullableString(value.bettingDeadline),
    bettingStartedAt: readNullableString(value.bettingStartedAt),
    spinStartedAt: readNullableString(value.spinStartedAt),
    spinDurationMs: readNumber(value.spinDurationMs),
    serverSeedHash: readString(value.serverSeedHash),
    serverSeed: readNullableString(value.serverSeed),
    nonce: readString(value.nonce),
    algorithm: readString(value.algorithm),
    aggregateClientSeed: readNullableString(value.aggregateClientSeed),
    participantSnapshotHash: readNullableString(value.participantSnapshotHash),
    winningTicket: readNullableString(value.winningTicket),
    winnerParticipantId: readNullableString(value.winnerParticipantId),
    winnerUserId: readNullableString(value.winnerUserId),
    payoutAzc: readNullableString(value.payoutAzc),
    participants: value.participants.map(parseParticipant),
    createdAt: readString(value.createdAt),
    resolvedAt: readNullableString(value.resolvedAt),
  };
}

function parseYou(value: unknown): RollsYou | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("invalid rolls you");
  }
  return {
    ...(typeof value.userId === "string" ? { userId: value.userId } : {}),
    stakeAzc: readString(value.stakeAzc),
    chancePercent: readString(value.chancePercent),
    participantId: readNullableString(value.participantId),
  };
}

function parseBoardWin(value: unknown): RollsBoardWin | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("invalid rolls board win");
  }
  return {
    roundId: readString(value.roundId),
    winnerId: readString(value.winnerId),
    winnerName: readString(value.winnerName),
    winnerUsername: readNullableString(value.winnerUsername),
    winnerAvatar: readNullableString(value.winnerAvatar),
    winnerInitials: readString(value.winnerInitials),
    amount: readString(value.amount),
    chance: readString(value.chance),
    finishedAt: readNullableString(value.finishedAt),
  };
}

export function parseRollsCurrent(value: unknown): RollsCurrent {
  if (!isRecord(value)) {
    throw new Error("invalid rolls current");
  }
  return {
    round: parseRollsRound(value.round),
    serverTime: readString(value.serverTime),
    you: parseYou(value.you),
    previous: parseBoardWin(value.previous ?? null),
    top: parseBoardWin(value.top ?? null),
  };
}

export function parseRollsBetResult(value: unknown): {
  round: RollsRound;
  you: RollsYou;
  replayed: boolean;
  newBalanceAzc?: string;
} {
  if (!isRecord(value) || !isRecord(value.you)) {
    throw new Error("invalid rolls bet");
  }
  return {
    round: parseRollsRound(value.round),
    you: parseYou(value.you) as RollsYou,
    replayed: Boolean(value.replayed),
    ...(typeof value.newBalanceAzc === "string"
      ? { newBalanceAzc: value.newBalanceAzc }
      : {}),
  };
}

export function parseRollsHistory(value: unknown): {
  items: RollsHistoryItem[];
  nextCursor: string | null;
} {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid rolls history");
  }
  return {
    items: value.items.map((item) => {
      if (!isRecord(item)) {
        throw new Error("invalid rolls history item");
      }
      return {
        roundId: readString(item.roundId),
        ownStakeAzc: readString(item.ownStakeAzc),
        totalPotAzc: readString(item.totalPotAzc),
        chancePercent: readString(item.chancePercent),
        won: Boolean(item.won),
        payoutAzc: readString(item.payoutAzc),
        participantCount: readNumber(item.participantCount),
        resolvedAt: readNullableString(item.resolvedAt),
        serverSeedHash: readString(item.serverSeedHash),
        serverSeed: readNullableString(item.serverSeed),
      };
    }),
    nextCursor: readNullableString(value.nextCursor),
  };
}
