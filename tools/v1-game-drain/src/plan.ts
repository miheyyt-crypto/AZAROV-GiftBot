import {
  MINES_ALLOWED_COUNTS,
  MINES_GRID_SIZE,
  minesPotentialWin,
  towerPotentialWin,
} from "./v1-payout.js";

export type DrainAction = "cashout" | "refund" | "skip" | "block";

export type GamePlan = {
  kind: "mines" | "tower" | "rolls";
  id: string;
  status: string;
  stake: number;
  progress: Record<string, number | string | null>;
  cashoutAvailable: boolean;
  cashoutAmount: number | null;
  recommended: DrainAction;
  reason: string;
  refunds?: { stake: number }[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function intOrNaN(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return Number.NaN;
}

export function planMinesGame(id: string, row: Record<string, unknown>): GamePlan {
  const status = String(row.status ?? "");
  const stake = intOrNaN(row.bet);
  const revealed = Array.isArray(row.revealed) ? row.revealed.length : Number.NaN;
  const mineCount = intOrNaN(row.mineCount);
  const gridSize = intOrNaN(row.gridSize) || MINES_GRID_SIZE;
  const progress = {
    revealed: Number.isFinite(revealed) ? revealed : -1,
    mineCount: Number.isFinite(mineCount) ? mineCount : -1,
    gridSize,
  };

  if (status === "lost" || status === "won" || status === "cancelled") {
    return {
      kind: "mines",
      id,
      status,
      stake: Number.isFinite(stake) ? stake : 0,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "skip",
      reason: "already settled",
    };
  }
  if (status !== "playing") {
    return {
      kind: "mines",
      id,
      status,
      stake: Number.isFinite(stake) ? stake : 0,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "malformed mines status; refusing to guess",
    };
  }
  if (!Number.isFinite(stake) || stake < 1) {
    return {
      kind: "mines",
      id,
      status,
      stake: 0,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "playing mines missing integer stake",
    };
  }
  if (!Number.isFinite(revealed) || revealed < 0) {
    return {
      kind: "mines",
      id,
      status,
      stake,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "playing mines missing revealed[]",
    };
  }
  if (!MINES_ALLOWED_COUNTS.includes(mineCount)) {
    return {
      kind: "mines",
      id,
      status,
      stake,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "playing mines has invalid mineCount",
    };
  }
  if (revealed < 1) {
    return {
      kind: "mines",
      id,
      status,
      stake,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "refund",
      reason: "V1 cashout requires ≥1 safe cell; refund exact stake",
    };
  }
  const payout = minesPotentialWin(stake, revealed, mineCount, gridSize);
  if (payout < 1) {
    return {
      kind: "mines",
      id,
      status,
      stake,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "V1 minesPotentialWin < 1; refusing to invent payout",
    };
  }
  return {
    kind: "mines",
    id,
    status,
    stake,
    progress,
    cashoutAvailable: true,
    cashoutAmount: payout,
    recommended: "cashout",
    reason: "V1 cashoutMinesOnStore from persisted revealed length",
  };
}

export function planTowerGame(id: string, row: Record<string, unknown>): GamePlan {
  const status = String(row.status ?? "");
  const stake = intOrNaN(row.bet);
  const floorsCleared = intOrNaN(row.floorsCleared);
  const progress = {
    floorsCleared: Number.isFinite(floorsCleared) ? floorsCleared : -1,
  };
  if (status === "lost" || status === "won" || status === "cancelled") {
    return {
      kind: "tower",
      id,
      status,
      stake: Number.isFinite(stake) ? stake : 0,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "skip",
      reason: "already settled",
    };
  }
  if (status !== "playing") {
    return {
      kind: "tower",
      id,
      status,
      stake: Number.isFinite(stake) ? stake : 0,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "malformed tower status; refusing to guess",
    };
  }
  if (!Number.isFinite(stake) || stake < 1) {
    return {
      kind: "tower",
      id,
      status,
      stake: 0,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "playing tower missing integer stake",
    };
  }
  if (!Number.isFinite(floorsCleared) || floorsCleared < 0) {
    return {
      kind: "tower",
      id,
      status,
      stake,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "playing tower missing floorsCleared",
    };
  }
  if (floorsCleared < 1) {
    return {
      kind: "tower",
      id,
      status,
      stake,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "refund",
      reason: "V1 cashout requires ≥1 floor; refund exact stake",
    };
  }
  const payout = towerPotentialWin(stake, floorsCleared);
  if (payout < 1) {
    return {
      kind: "tower",
      id,
      status,
      stake,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "V1 towerPotentialWin < 1; refusing to invent payout",
    };
  }
  return {
    kind: "tower",
    id,
    status,
    stake,
    progress,
    cashoutAvailable: true,
    cashoutAmount: payout,
    recommended: "cashout",
    reason: "V1 cashoutTowerOnStore from persisted floorsCleared",
  };
}

export function planRollsRound(id: string, row: Record<string, unknown>): GamePlan {
  const status = String(row.status ?? "");
  const players = Array.isArray(row.players) ? row.players : [];
  let stake = 0;
  const refunds: { stake: number }[] = [];
  for (const raw of players) {
    const player = asRecord(raw);
    const bet = intOrNaN(player.bet);
    if (!Number.isFinite(bet) || bet < 0) {
      return {
        kind: "rolls",
        id,
        status,
        stake: 0,
        progress: { players: players.length, pot: intOrNaN(row.pot) },
        cashoutAvailable: false,
        cashoutAmount: null,
        recommended: "block",
        reason: "rolls player bet is not a non-negative integer",
      };
    }
    stake += bet;
    if (bet > 0) {
      refunds.push({ stake: bet });
    }
  }
  const pot = intOrNaN(row.pot);
  const progress = {
    players: players.length,
    pot: Number.isFinite(pot) ? pot : -1,
    betSum: stake,
  };
  if (status === "completed" || status === "cancelled") {
    return {
      kind: "rolls",
      id,
      status,
      stake,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "skip",
      reason: "already settled",
    };
  }
  const open =
    status === "waiting" ||
    status === "betting" ||
    status === "locked" ||
    status === "spinning";
  if (!open) {
    return {
      kind: "rolls",
      id,
      status,
      stake,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "unknown rolls status; refusing to guess",
    };
  }
  if (players.length === 0 && stake === 0 && (pot === 0 || !Number.isFinite(pot))) {
    return {
      kind: "rolls",
      id,
      status,
      stake: 0,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "skip",
      reason: "empty waiting lobby; no AZC debited",
    };
  }
  if (stake < 1) {
    return {
      kind: "rolls",
      id,
      status,
      stake,
      progress,
      cashoutAvailable: false,
      cashoutAmount: null,
      recommended: "block",
      reason: "open rolls round with unproven pot/bets",
    };
  }
  return {
    kind: "rolls",
    id,
    status,
    stake,
    progress,
    cashoutAvailable: false,
    cashoutAmount: null,
    recommended: "refund",
    reason: "cannot RNG-settle rolls offline; refund each debited bet",
    refunds,
  };
}
