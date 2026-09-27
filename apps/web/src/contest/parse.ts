import type {
  AdminReferralContestDetail,
  AdminReferralContestList,
  AdminReferralContestListItem,
  ReferralContestHomeSummary,
  ReferralContestLeaderboardEntry,
  ReferralContestMe,
  ReferralContestPage,
  ReferralContestPrize,
  ReferralContestPublic,
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

export function parseContestPublic(value: unknown): ReferralContestPublic {
  if (!isRecord(value) || !Array.isArray(value.prizes)) {
    throw new Error("invalid contest");
  }
  return {
    id: readString(value.id),
    status: parseStatus(value.status),
    title: readString(value.title),
    startAt: readString(value.startAt),
    endAt: readString(value.endAt),
    prizePoolAzc: readString(value.prizePoolAzc),
    prizePlaces: readNumber(value.prizePlaces),
    prizes: value.prizes.map(parsePrize),
    finalizedAt:
      value.finalizedAt === undefined ? null : readNullableString(value.finalizedAt),
  };
}

export function parseContestHomeSummaryResponse(value: unknown): {
  contest: ReferralContestHomeSummary | null;
} {
  if (!isRecord(value)) {
    throw new Error("invalid contest summary");
  }
  if (value.contest === null) {
    return { contest: null };
  }
  if (!isRecord(value.contest)) {
    throw new Error("invalid contest summary");
  }
  const row = value.contest;
  return {
    contest: {
      id: readString(row.id),
      status: parseStatus(row.status),
      title: readString(row.title),
      startAt: readString(row.startAt),
      endAt: readString(row.endAt),
      prizePoolAzc: readString(row.prizePoolAzc),
      prizePlaces: readNumber(row.prizePlaces),
      serverNow: readString(row.serverNow),
    },
  };
}

function parseEntry(value: unknown): ReferralContestLeaderboardEntry {
  if (!isRecord(value)) {
    throw new Error("invalid contest entry");
  }
  return {
    rank: readNumber(value.rank),
    publicId: readNullableString(value.publicId),
    displayName: readNullableString(value.displayName),
    username: readNullableString(value.username),
    avatarUrl:
      value.avatarUrl === undefined ? null : readNullableString(value.avatarUrl),
    referralCount: readNumber(value.referralCount),
    prizePlace: value.prizePlace === null ? null : readNumber(value.prizePlace),
    rewardAzc: value.rewardAzc === null ? null : readString(value.rewardAzc),
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
    nextRankGap: readNumber(value.nextRankGap),
    prizePlace: value.prizePlace === null ? null : readNumber(value.prizePlace),
    potentialRewardAzc:
      value.potentialRewardAzc === null
        ? null
        : readString(value.potentialRewardAzc),
    referralUrl:
      value.referralUrl === undefined || value.referralUrl === null
        ? null
        : readString(value.referralUrl),
  };
}

export function parseContestPage(value: unknown): ReferralContestPage {
  if (!isRecord(value)) {
    throw new Error("invalid contest page");
  }
  const contest = value.contest === null ? null : parseContestPublic(value.contest);
  const leaderboard = Array.isArray(value.leaderboard)
    ? value.leaderboard.map(parseEntry)
    : [];
  const me = contest && value.me ? parseMe(value.me) : null;
  return {
    contest,
    leaderboard,
    me,
    serverNow: readString(value.serverNow),
  };
}

function parseAdminListItem(value: unknown): AdminReferralContestListItem {
  if (!isRecord(value) || !Array.isArray(value.top10)) {
    throw new Error("invalid admin contest");
  }
  return {
    ...parseContestPublic(value),
    participantCount: readNumber(value.participantCount),
    top10: value.top10.map(parseEntry),
  };
}

export function parseAdminContestList(value: unknown): AdminReferralContestList {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid admin contest list");
  }
  return {
    items: value.items.map(parseAdminListItem),
    serverNow: readString(value.serverNow),
  };
}

export function parseAdminContestDetail(value: unknown): AdminReferralContestDetail {
  if (!isRecord(value) || !Array.isArray(value.leaderboard) || !Array.isArray(value.winners)) {
    throw new Error("invalid admin contest detail");
  }
  return {
    contest: parseContestPublic(value.contest),
    participantCount: readNumber(value.participantCount),
    leaderboard: value.leaderboard.map(parseEntry),
    winners: value.winners.map(parseEntry),
    serverNow: readString(value.serverNow),
  };
}

export function contestDisplayName(row: {
  displayName: string | null;
  username: string | null;
  publicId: string | null;
}): string {
  if (row.username) {
    return `@${row.username.replace(/^@/, "")}`;
  }
  return row.displayName || row.publicId || "Игрок";
}
