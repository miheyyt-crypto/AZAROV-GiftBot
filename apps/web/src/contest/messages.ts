import { formatCountdown, remainingFromEndsAt } from "../giveaways/messages.js";
import type { ReferralContestMe, ReferralContestPublicStatus } from "./types.js";

export { formatCountdown, remainingFromEndsAt };

export function contestStatusLabel(status: ReferralContestPublicStatus): string {
  switch (status) {
    case "scheduled":
      return "Скоро старт";
    case "active":
      return "Идёт сейчас";
    case "ended":
      return "Конкурс завершён";
    case "finalized":
      return "Конкурс завершён";
  }
}

export function myPositionHint(me: ReferralContestMe): string | null {
  if (me.prizePlace && me.potentialRewardAzc) {
    return `${me.prizePlace} место · потенциальная награда ${me.potentialRewardAzc} AZC`;
  }
  if (me.nextRankGap > 0 && me.rank > 1) {
    return `До ${me.rank - 1} места: ${me.nextRankGap} реферала`;
  }
  if (me.rank > 10) {
    return "Пригласи друзей, чтобы войти в TOP 10";
  }
  return null;
}

export function medalForPlace(place: number): string {
  if (place === 1) {
    return "🥇";
  }
  if (place === 2) {
    return "🥈";
  }
  if (place === 3) {
    return "🥉";
  }
  return "";
}
