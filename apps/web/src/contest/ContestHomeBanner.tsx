import { navigate } from "../app/routes.js";
import { IconChevron, IconCoin } from "../assets/icons.js";
import { formatAzcAmount } from "../lib/format.js";
import {
  contestStatusLabel,
  formatCountdown,
  remainingFromEndsAt,
} from "./messages.js";
import type { ReferralContestHomeSummary } from "./types.js";

export function ContestHomeBanner({
  contest,
  fetchedAtMs,
  nowMs,
}: {
  contest: ReferralContestHomeSummary;
  fetchedAtMs: number;
  nowMs: number;
}) {
  const remaining = remainingFromEndsAt(
    contest.endAt,
    contest.serverNow,
    fetchedAtMs,
    nowMs,
  );
  const ended = contest.status === "ended" || contest.status === "finalized" || remaining <= 0;
  return (
    <button
      type="button"
      className="contest-home-banner"
      onClick={() => navigate("#/contest/referral")}
      data-testid="contest-home-banner"
    >
      <span className="contest-home-banner__kicker">РЕФЕРАЛЬНЫЙ БАТТЛ</span>
      <span className="contest-home-banner__pool">
        <IconCoin size={22} />
        {formatAzcAmount(contest.prizePoolAzc)}
      </span>
      <span className="contest-home-banner__pool-label">ПРИЗОВОЙ ФОНД</span>
      <span className="contest-home-banner__meta">
        <span>{contest.prizePlaces} ПРИЗОВЫХ МЕСТ</span>
        <span className="contest-home-banner__timer">
          {ended ? contestStatusLabel(contest.status) : formatCountdown(remaining)}
        </span>
      </span>
      <span className="contest-home-banner__cta">
        Участвовать
        <IconChevron size={16} />
      </span>
    </button>
  );
}
