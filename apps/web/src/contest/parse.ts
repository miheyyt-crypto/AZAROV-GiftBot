import type {
  ReferralContestHomeSummary,
  ReferralContestLeaderboardEntry,
  ReferralContestMe,
  ReferralContestPrize,
  ReferralContestPublicStatus,
} from "./types.js";

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

const STATUSES = new Set<ReferralContestPublicStatus>([
  "scheduled",
  "active",
  "ended",
  "finalized",
]);

function parseStatus(value: unknown): ReferralContestPublicStatus {
  const status = readString(value);
  if (!STATUSES.has(status as ReferralContestPublicStatus)) {
    throw new Error("invalid contest status");
  }
  return status as ReferralContestPublicStatus;
}

function parsePrize(value: unknown): ReferralContestPrize {
  if (!isRecord(value)) {
    throw new Error("invalid prize");
  }
  return {
    place: readNumber(value.place),
    rewardAzc: readString(value.rewardAzc),
  };
}

function parseEntry(value: unknown): ReferralContestLeaderboardEntry {
  if (!isRecord(value)) {
    throw new Error("invalid contest entry");
  }
  return {
    rank: readNumber(value.rank),
    displayName: value.displayName === undefined ? null : readNullableString(value.displayName),
    username: value.username === undefined ? null : readNullableString(value.username),
    avatarUrl:
      value.avatarUrl === undefined ? null : readNullableString(value.avatarUrl),
    referralCount: readNumber(value.referralCount),
    isYou: value.isYou === true,
  };
}

function parseMe(value: unknown): ReferralContestMe {
  if (!isRecord(value)) {
    throw new Error("invalid contest me");
  }
  return {
    rank: readNumber(value.rank),
    referralCount: readNumber(value.referralCount),
    potentialRewardAzc:
      value.potentialRewardAzc === undefined || value.potentialRewardAzc === null
        ? null
        : readString(value.potentialRewardAzc),
    referralUrl:
      value.referralUrl === undefined || value.referralUrl === null
        ? null
        : readString(value.referralUrl),
  };
}

export function parseContestHomeSummaryResponse(value: unknown): ReferralContestHomeSummary {
  if (!isRecord(value)) {
    throw new Error("invalid contest summary");
  }
  const serverNow = readString(value.serverNow);
  if (value.contest === null) {
    return {
      contest: null,
      leaderboard: [],
      me: parseMe(value.me ?? { rank: 0, referralCount: 0, potentialRewardAzc: null, referralUrl: null }),
      serverNow,
    };
  }
  if (!isRecord(value.contest) || !Array.isArray(value.contest.prizes)) {
    throw new Error("invalid contest summary");
  }
  const contest = value.contest;
  const prizes = value.contest.prizes;
  const leaderboard = Array.isArray(value.leaderboard)
    ? value.leaderboard.map(parseEntry)
    : [];
  return {
    contest: {
      id: readString(contest.id),
      status: parseStatus(contest.status),
      startAt: readString(contest.startAt),
      endAt: readString(contest.endAt),
      prizes: prizes.map(parsePrize),
      serverNow: readString(contest.serverNow ?? serverNow),
    },
    leaderboard,
    me: parseMe(value.me),
    serverNow,
  };
}

export function contestDisplayName(row: {
  displayName: string | null;
  username: string | null;
}): string {
  if (row.username) {
    return `@${row.username.replace(/^@/, "")}`;
  }
  return row.displayName || "Игрок";
}
