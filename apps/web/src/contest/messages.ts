import { formatCountdown, remainingFromEndsAt } from "../giveaways/messages.js";
import type { ReferralContestPublicStatus } from "./types.js";

export { formatCountdown, remainingFromEndsAt };

export function contestStatusLabel(status: ReferralContestPublicStatus): string {
  switch (status) {
    case "scheduled":
      return "Скоро старт";
    case "active":
      return "Идёт сейчас";
    case "ended":
    case "finalized":
      return "КОНКУРС ЗАВЕРШЁН";
  }
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
  return `${place}.`;
}
