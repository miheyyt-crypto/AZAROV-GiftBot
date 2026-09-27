import { asAzc } from "./parse-store.js";

export type GameDiagnostic = {
  kind: "mines" | "tower" | "rolls";
  id: string;
  status: string;
  participantOrBetCount: number;
  totalDebitedAzc: string;
  settlementPending: boolean;
  financiallyBlocking: boolean;
  staleNonFinancial: boolean;
  reason: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function playerBets(row: Record<string, unknown>): { count: number; sum: bigint } {
  const players = Array.isArray(row.players) ? row.players : [];
  let sum = 0n;
  let count = 0;
  for (const raw of players) {
    const player = asRecord(raw);
    const bet = asAzc(player.bet) ?? 0n;
    if (bet > 0n) {
      count += 1;
      sum += bet;
    } else {
      count += 1;
    }
  }
  return { count, sum };
}

/** V1 Mines start spendCoins before status=playing. Playing with a stake is money at risk. */
export function classifyMinesGame(id: string, row: Record<string, unknown>): GameDiagnostic {
  const status = String(row.status ?? "");
  const bet = asAzc(row.bet) ?? 0n;
  if (status === "playing") {
    if (bet > 0n) {
      return {
        kind: "mines",
        id,
        status,
        participantOrBetCount: 1,
        totalDebitedAzc: bet.toString(),
        settlementPending: true,
        financiallyBlocking: true,
        staleNonFinancial: false,
        reason: "V1 already debited mines stake; cashout/loss unresolved",
      };
    }
    return {
      kind: "mines",
      id,
      status,
      participantOrBetCount: 1,
      totalDebitedAzc: "0",
      settlementPending: true,
      financiallyBlocking: true,
      staleNonFinancial: false,
      reason: "playing mines row with unproven stake; cannot drop",
    };
  }
  return {
    kind: "mines",
    id,
    status,
    participantOrBetCount: 1,
    totalDebitedAzc: "0",
    settlementPending: false,
    financiallyBlocking: false,
    staleNonFinancial: false,
    reason: "resolved mines record",
  };
}

/** V1 Tower start spendCoins before status=playing. */
export function classifyTowerGame(id: string, row: Record<string, unknown>): GameDiagnostic {
  const status = String(row.status ?? "");
  const bet = asAzc(row.bet) ?? 0n;
  if (status === "playing") {
    if (bet > 0n) {
      return {
        kind: "tower",
        id,
        status,
        participantOrBetCount: 1,
        totalDebitedAzc: bet.toString(),
        settlementPending: true,
        financiallyBlocking: true,
        staleNonFinancial: false,
        reason: "V1 already debited tower stake; cashout/loss unresolved",
      };
    }
    return {
      kind: "tower",
      id,
      status,
      participantOrBetCount: 1,
      totalDebitedAzc: "0",
      settlementPending: true,
      financiallyBlocking: true,
      staleNonFinancial: false,
      reason: "playing tower row with unproven stake; cannot drop",
    };
  }
  return {
    kind: "tower",
    id,
    status,
    participantOrBetCount: 1,
    totalDebitedAzc: "0",
    settlementPending: false,
    financiallyBlocking: false,
    staleNonFinancial: false,
    reason: "resolved tower record",
  };
}

/**
 * V1 createEmptyRound is waiting with players=[] and pot=0 — no debit.
 * Bets spendCoins only on join/add while waiting or betting.
 */
export function classifyRollsRound(id: string, row: Record<string, unknown>): GameDiagnostic {
  const status = String(row.status ?? "");
  const { count, sum } = playerBets(row);
  const pot = asAzc(row.pot ?? row.totalPot) ?? 0n;
  const debited = pot > sum ? pot : sum;
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
      participantOrBetCount: count,
      totalDebitedAzc: "0",
      settlementPending: false,
      financiallyBlocking: false,
      staleNonFinancial: false,
      reason: "resolved rolls round",
    };
  }
  if (status === "waiting" && count === 0 && debited === 0n) {
    return {
      kind: "rolls",
      id,
      status,
      participantOrBetCount: 0,
      totalDebitedAzc: "0",
      settlementPending: false,
      financiallyBlocking: false,
      staleNonFinancial: true,
      reason: "empty waiting lobby; no AZC debited",
    };
  }
  if (debited > 0n) {
    return {
      kind: "rolls",
      id,
      status,
      participantOrBetCount: count,
      totalDebitedAzc: debited.toString(),
      settlementPending: true,
      financiallyBlocking: true,
      staleNonFinancial: false,
      reason: "rolls round has debited bets/pot not settled",
    };
  }
  return {
    kind: "rolls",
    id,
    status,
    participantOrBetCount: count,
    totalDebitedAzc: "0",
    settlementPending: true,
    financiallyBlocking: true,
    staleNonFinancial: false,
    reason: "open rolls round with unproven money state; cannot drop",
  };
}
