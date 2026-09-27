import type {
  GiveawayAdminDetail,
  GiveawayAdminListItem,
  GiveawayDbStatus,
  GiveawayEligibility,
  GiveawayParticipantAdmin,
  GiveawayPublic,
  GiveawayPublicStatus,
  GiveawayType,
  GiveawayWinnerPublic,
  GiveawaysListResponse,
  JoinGiveawayResult,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("invalid nullable string");
  }
  return value;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

const PUBLIC_STATUSES = new Set<GiveawayPublicStatus>([
  "draft",
  "active",
  "drawing",
  "completed",
  "cancelled",
]);

const DB_STATUSES = new Set<GiveawayDbStatus>([
  "draft",
  "open",
  "closed",
  "settled",
  "cancelled",
]);

const TYPES = new Set<GiveawayType>(["coins", "custom_prize"]);
const ELIGIBILITIES = new Set<GiveawayEligibility>(["linked_kick"]);

function parseType(value: unknown): GiveawayType {
  const raw = readString(value, "type");
  if (!TYPES.has(raw as GiveawayType)) {
    throw new Error("invalid type");
  }
  return raw as GiveawayType;
}

function parsePublicStatus(value: unknown): GiveawayPublicStatus {
  const raw = readString(value, "status");
  if (!PUBLIC_STATUSES.has(raw as GiveawayPublicStatus)) {
    throw new Error("invalid status");
  }
  return raw as GiveawayPublicStatus;
}

function parseDbStatus(value: unknown): GiveawayDbStatus {
  const raw = readString(value, "status");
  if (!DB_STATUSES.has(raw as GiveawayDbStatus)) {
    throw new Error("invalid db status");
  }
  return raw as GiveawayDbStatus;
}

function parseEligibility(value: unknown): GiveawayEligibility {
  const raw = readString(value, "eligibility");
  if (!ELIGIBILITIES.has(raw as GiveawayEligibility)) {
    throw new Error("invalid eligibility");
  }
  return raw as GiveawayEligibility;
}

export function parseGiveawayWinner(value: unknown): GiveawayWinnerPublic {
  if (!isRecord(value)) {
    throw new Error("invalid winner");
  }
  return {
    userId: readString(value.userId, "userId"),
    publicId: readString(value.publicId, "publicId"),
    prizeAzc: readNullableString(value.prizeAzc),
    prizeText: readNullableString(value.prizeText),
    deliveryStatus: readNullableString(value.deliveryStatus),
  };
}

export function parseGiveawayPublic(value: unknown): GiveawayPublic {
  if (!isRecord(value)) {
    throw new Error("invalid giveaway");
  }
  const winnersRaw = value.winners;
  let winners: GiveawayWinnerPublic[] | null = null;
  if (winnersRaw !== null && winnersRaw !== undefined) {
    if (!Array.isArray(winnersRaw)) {
      throw new Error("invalid winners");
    }
    winners = winnersRaw.map(parseGiveawayWinner);
  }
  return {
    id: readString(value.id, "id"),
    title: readString(value.title, "title"),
    type: parseType(value.type),
    status: parsePublicStatus(value.status),
    bankAzc: readNullableString(value.bankAzc),
    customPrize: readNullableString(value.customPrize),
    winnerCount: readNumber(value.winnerCount, "winnerCount"),
    actualWinnerCount:
      value.actualWinnerCount === null || value.actualWinnerCount === undefined
        ? null
        : readNumber(value.actualWinnerCount, "actualWinnerCount"),
    eligibility: parseEligibility(value.eligibility),
    endsAt: readNullableString(value.endsAt),
    participantCount: readNumber(value.participantCount, "participantCount"),
    joined: readBoolean(value.joined, "joined"),
    eligible: readBoolean(value.eligible, "eligible"),
    winners,
    serverTime: readString(value.serverTime, "serverTime"),
    imageUrl:
      value.imageUrl === undefined ? null : readNullableString(value.imageUrl),
  };
}

export function parseGiveawaysList(value: unknown): GiveawaysListResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid giveaways list");
  }
  return {
    items: value.items.map(parseGiveawayPublic),
    serverTime: readString(value.serverTime, "serverTime"),
  };
}

export function parseJoinGiveawayResult(value: unknown): JoinGiveawayResult {
  if (!isRecord(value)) {
    throw new Error("invalid join result");
  }
  return {
    id: readString(value.id, "id"),
    replayed: value.replayed === true,
  };
}

export function parseGiveawayAdminListItem(value: unknown): GiveawayAdminListItem {
  if (!isRecord(value)) {
    throw new Error("invalid admin giveaway");
  }
  return {
    id: readString(value.id, "id"),
    title: readString(value.title, "title"),
    type: parseType(value.type),
    status: parseDbStatus(value.status),
    publicStatus: parsePublicStatus(value.publicStatus),
    bankAzc: readNullableString(value.bankAzc),
    customPrize: readNullableString(value.customPrize),
    winnerCount: readNumber(value.winnerCount, "winnerCount"),
    actualWinnerCount:
      value.actualWinnerCount === null || value.actualWinnerCount === undefined
        ? null
        : readNumber(value.actualWinnerCount, "actualWinnerCount"),
    eligibility: parseEligibility(value.eligibility),
    endsAt: readNullableString(value.endsAt),
    participantCount: readNumber(value.participantCount, "participantCount"),
    createdAt: readString(value.createdAt, "createdAt"),
    activatedAt: readNullableString(value.activatedAt),
    drawnAt: readNullableString(value.drawnAt),
    completedAt: readNullableString(value.completedAt),
    cancelledAt: readNullableString(value.cancelledAt),
    imageUrl:
      value.imageUrl === undefined ? null : readNullableString(value.imageUrl),
  };
}

export function parseAdminGiveawaysList(
  value: unknown,
): { items: GiveawayAdminListItem[]; nextCursor: string | null } {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("invalid admin giveaways list");
  }
  return {
    items: value.items.map(parseGiveawayAdminListItem),
    nextCursor: readNullableString(value.nextCursor),
  };
}

function parseParticipant(value: unknown): GiveawayParticipantAdmin {
  if (!isRecord(value)) {
    throw new Error("invalid participant");
  }
  return {
    entryId: readString(value.entryId, "entryId"),
    userId: readString(value.userId, "userId"),
    publicId: readString(value.publicId, "publicId"),
    status: readString(value.status, "status"),
    createdAt: readString(value.createdAt, "createdAt"),
    isWinner: value.isWinner === true,
  };
}

export function parseAdminGiveawayDetail(value: unknown): GiveawayAdminDetail {
  if (
    !isRecord(value) ||
    !Array.isArray(value.winners) ||
    !Array.isArray(value.participants)
  ) {
    throw new Error("invalid admin giveaway detail");
  }
  return {
    giveaway: parseGiveawayAdminListItem(value.giveaway),
    winners: value.winners.map(parseGiveawayWinner),
    participants: value.participants.map(parseParticipant),
    participantsNextCursor: readNullableString(value.participantsNextCursor),
  };
}
