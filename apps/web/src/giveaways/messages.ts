import { formatAzcAmount } from "../lib/format.js";
import type { GiveawayPublic } from "./types.js";

export function prizeLabel(giveaway: GiveawayPublic): string {
  if (giveaway.type === "coins" && giveaway.bankAzc) {
    return formatAzcAmount(giveaway.bankAzc);
  }
  if (giveaway.customPrize) {
    return giveaway.customPrize;
  }
  return "Приз";
}

export function eligibilityLabel(eligibility: string): string {
  if (eligibility === "linked_kick") {
    return "Привязанный Kick";
  }
  return eligibility;
}

export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Remaining seconds until endsAt, corrected by serverTime vs fetch clock. */
export function remainingFromEndsAt(
  endsAt: string | null,
  serverTime: string,
  fetchedAtMs: number,
  nowMs: number,
): number {
  if (!endsAt) {
    return 0;
  }
  const endsMs = Date.parse(endsAt);
  const serverMs = Date.parse(serverTime);
  if (!Number.isFinite(endsMs) || !Number.isFinite(serverMs)) {
    return 0;
  }
  const elapsed = Math.max(0, nowMs - fetchedAtMs);
  return Math.max(0, Math.floor((endsMs - serverMs - elapsed) / 1000));
}

export function friendlyGiveawayError(code?: string): string {
  switch (code) {
    case "GIVEAWAY_NOT_FOUND":
      return "Розыгрыш не найден";
    case "GIVEAWAY_CLOSED":
      return "Розыгрыш уже закрыт";
    case "GIVEAWAY_NOT_ELIGIBLE":
      return "Нужно привязать Kick";
    case "GIVEAWAY_INVALID_STATE":
      return "Розыгрыш недоступен";
    default:
      return "Не удалось участвовать. Попробуйте ещё раз";
  }
}

export function winnerPrizeLabel(winner: {
  prizeAzc: string | null;
  prizeText: string | null;
}): string {
  if (winner.prizeAzc) {
    return formatAzcAmount(winner.prizeAzc);
  }
  if (winner.prizeText) {
    return winner.prizeText;
  }
  return "Приз";
}

export function isViewerWinner(
  giveaway: GiveawayPublic,
  viewerPublicId: string | undefined,
): boolean {
  if (!viewerPublicId || !giveaway.winners || giveaway.winners.length === 0) {
    return false;
  }
  return giveaway.winners.some((w) => w.publicId === viewerPublicId);
}
