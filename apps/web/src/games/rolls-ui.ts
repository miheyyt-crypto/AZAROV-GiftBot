import type { RollsHistoryItem } from "./rolls-types.js";

export function formatChancePercent(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return value;
  }
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function previousHistoryItem(items: RollsHistoryItem[]): RollsHistoryItem | undefined {
  return items[0];
}

export function topHistoryItem(items: RollsHistoryItem[]): RollsHistoryItem | undefined {
  return items.reduce<RollsHistoryItem | undefined>((best, item) => {
    if (!best) {
      return item;
    }
    return Number(item.totalPotAzc) > Number(best.totalPotAzc) ? item : best;
  }, undefined);
}

export function rollsWinnerCardName(
  winnerId: string,
  winnerName: string,
  viewerUserId: string | null | undefined,
): string {
  if (viewerUserId != null && String(winnerId) === String(viewerUserId)) {
    return "Вы";
  }
  const trimmed = winnerName.trim();
  return trimmed || "Игрок";
}

export function formatPlayerName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Игрок";
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed.replace(/^@/, "")}`;
}

export function formatRollsGameTitle(nonce: string): string {
  const trimmed = nonce.trim();
  return trimmed ? `Игра #${trimmed}` : "Игра";
}

export function winnerChancePercent(stakeAzc: string, totalPotAzc: string): string {
  const stake = Number(stakeAzc);
  const pot = Number(totalPotAzc);
  if (!Number.isFinite(stake) || !Number.isFinite(pot) || pot <= 0) {
    return "0";
  }
  return formatChancePercent(String((stake / pot) * 100));
}

export function winMultiplier(payoutAzc: string, stakeAzc: string): string {
  const payout = Number(payoutAzc);
  const stake = Number(stakeAzc);
  if (!Number.isFinite(payout) || !Number.isFinite(stake) || stake <= 0) {
    return "1";
  }
  const ratio = payout / stake;
  const rounded = Math.round(ratio * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function gameLabel(roundId: string | undefined): string {
  if (!roundId) {
    return "—";
  }
  return roundId.length > 12 ? roundId.slice(0, 8) : roundId;
}
