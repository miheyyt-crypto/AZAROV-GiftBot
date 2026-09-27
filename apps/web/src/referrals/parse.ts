import type {
  ReferralListItem,
  ReferralListResponse,
  ReferralMeSummary,
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

function readNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("expected number");
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return readString(value);
}

export function parseReferralMe(value: unknown): ReferralMeSummary {
  if (!isRecord(value) || !isRecord(value.stats) || !isRecord(value.caseProgress)) {
    throw new Error("invalid referral me");
  }
  return {
    referralUrl: readString(value.referralUrl),
    token: readString(value.token),
    stats: {
      invited: readNumber(value.stats.invited),
      active: readNumber(value.stats.active),
      earnedAzc: readString(value.stats.earnedAzc),
    },
    caseProgress: {
      current: readNumber(value.caseProgress.current),
      target: readNumber(value.caseProgress.target),
      availableCases: readNumber(value.caseProgress.availableCases),
      totalCasesEarned: readNumber(value.caseProgress.totalCasesEarned),
    },
  };
}

function parseReferralListItem(value: unknown): ReferralListItem {
  if (!isRecord(value)) {
    throw new Error("invalid referral list item");
  }
  const status = value.status;
  if (status !== "attributed" && status !== "activated") {
    throw new Error("invalid referral status");
  }
  return {
    id: readString(value.id),
    status,
    statusLabel: readString(value.statusLabel),
    username: readNullableString(value.username),
    publicId: readNullableString(value.publicId),
    avatarUrl:
      value.avatarUrl === undefined ? null : readNullableString(value.avatarUrl),
    attributedAt: readString(value.attributedAt),
    activatedAt: readNullableString(value.activatedAt),
  };
}

export function parseReferralList(value: unknown): ReferralListResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid referral list");
  }
  return {
    items: value.items.map(parseReferralListItem),
    nextCursor: readNullableString(value.nextCursor),
  };
}
