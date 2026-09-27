export type GiveawayPublicStatus =
  | "draft"
  | "active"
  | "drawing"
  | "completed"
  | "cancelled";

export type GiveawayType = "coins" | "custom_prize";
export type GiveawayEligibility = "linked_kick";
export type GiveawayTab = "active" | "completed";

export type GiveawayWinnerPublic = {
  userId: string;
  publicId: string;
  prizeAzc: string | null;
  prizeText: string | null;
  deliveryStatus: string | null;
};

export type GiveawayPublic = {
  id: string;
  title: string;
  type: GiveawayType;
  status: GiveawayPublicStatus;
  bankAzc: string | null;
  customPrize: string | null;
  winnerCount: number;
  actualWinnerCount: number | null;
  eligibility: GiveawayEligibility;
  endsAt: string | null;
  participantCount: number;
  joined: boolean;
  eligible: boolean;
  winners: GiveawayWinnerPublic[] | null;
  serverTime: string;
  imageUrl: string | null;
};

export type GiveawaysListResponse = {
  items: GiveawayPublic[];
  serverTime: string;
};

export type GiveawayDbStatus =
  | "draft"
  | "open"
  | "closed"
  | "settled"
  | "cancelled";

export type GiveawayAdminListItem = {
  id: string;
  title: string;
  type: GiveawayType;
  status: GiveawayDbStatus;
  publicStatus: GiveawayPublicStatus;
  bankAzc: string | null;
  customPrize: string | null;
  winnerCount: number;
  actualWinnerCount: number | null;
  eligibility: GiveawayEligibility;
  endsAt: string | null;
  participantCount: number;
  createdAt: string;
  activatedAt: string | null;
  drawnAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  imageUrl: string | null;
};

export type GiveawayParticipantAdmin = {
  entryId: string;
  userId: string;
  publicId: string;
  status: string;
  createdAt: string;
  isWinner: boolean;
};

export type GiveawayAdminDetail = {
  giveaway: GiveawayAdminListItem;
  winners: GiveawayWinnerPublic[];
  participants: GiveawayParticipantAdmin[];
  participantsNextCursor: string | null;
};

export type JoinGiveawayResult = {
  id: string;
  replayed: boolean;
};
