export type RollsStatus = "waiting" | "betting" | "spinning" | "resolved";

export type RollsParticipant = {
  participantId: string;
  publicId: string;
  displayName: string;
  avatarKey: string | null;
  avatarUrl: string | null;
  stakeAzc: string;
  joinedAt: string;
};

export type RollsRound = {
  roundId: string;
  status: RollsStatus;
  version: string;
  participantCount: number;
  totalPotAzc: string;
  bettingDeadline: string | null;
  bettingStartedAt: string | null;
  spinStartedAt: string | null;
  spinDurationMs: number;
  serverSeedHash: string;
  serverSeed: string | null;
  nonce: string;
  algorithm: string;
  aggregateClientSeed: string | null;
  participantSnapshotHash: string | null;
  winningTicket: string | null;
  winnerParticipantId: string | null;
  winnerUserId: string | null;
  payoutAzc: string | null;
  participants: RollsParticipant[];
  createdAt: string;
  resolvedAt: string | null;
};

export type RollsYou = {
  userId?: string;
  stakeAzc: string;
  chancePercent: string;
  participantId: string | null;
};

export type RollsBoardWin = {
  roundId: string;
  winnerId: string;
  winnerName: string;
  winnerUsername: string | null;
  winnerAvatar: string | null;
  winnerInitials: string;
  amount: string;
  chance: string;
  finishedAt: string | null;
};

export type RollsCurrent = {
  round: RollsRound;
  serverTime: string;
  you: RollsYou | null;
  previous: RollsBoardWin | null;
  top: RollsBoardWin | null;
};

export type RollsHistoryItem = {
  roundId: string;
  ownStakeAzc: string;
  totalPotAzc: string;
  chancePercent: string;
  won: boolean;
  payoutAzc: string;
  participantCount: number;
  resolvedAt: string | null;
  serverSeedHash: string;
  serverSeed: string | null;
};
