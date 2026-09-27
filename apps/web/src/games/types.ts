export type MinesGameStatus = "active" | "cashed_out" | "lost" | "cleared";

export type MinesGame = {
  gameId: string;
  status: MinesGameStatus;
  betAzc: string;
  mineCount: number;
  revealedCells: number[];
  safePickCount: number;
  currentMultiplier: string | null;
  potentialPayoutAzc: string | null;
  payoutAzc: string | null;
  serverSeedHash: string;
  serverSeed: string | null;
  clientSeed: string;
  nonce: string;
  algorithm: string;
  minePositions: number[] | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type DiceRound = {
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

export const MINE_COUNTS = [3, 5, 7, 10, 15, 20, 24] as const;
