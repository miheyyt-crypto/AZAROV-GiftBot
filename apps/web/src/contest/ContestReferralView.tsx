import { Avatar } from "../components/Avatar.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { IconTelegram } from "../assets/icons.js";
import { PageHeader } from "../components/PageHeader.js";
import { formatAzcAmount } from "../lib/format.js";
import { contestDisplayName } from "./parse.js";
import {
  contestStatusLabel,
  formatCountdown,
  medalForPlace,
  myPositionHint,
  remainingFromEndsAt,
} from "./messages.js";
import type { ReferralContestPage } from "./types.js";

export function ContestReferralView({
  page,
  fetchedAtMs,
  nowMs,
  onInvite,
}: {
  page: ReferralContestPage;
  fetchedAtMs: number;
  nowMs: number;
  onInvite: () => void;
}) {
  const contest = page.contest;
  if (!contest) {
    return (
      <div className="stack contest-page">
        <PageHeader title="Реферальный баттл" backHref="#/" />
        <section className="card">
          <p className="muted">Сейчас нет реферального конкурса.</p>
        </section>
      </div>
    );
  }

  const remaining = remainingFromEndsAt(
    contest.endAt,
    page.serverNow,
    fetchedAtMs,
    nowMs,
  );
  const ended =
    contest.status === "ended" ||
    contest.status === "finalized" ||
    remaining <= 0;
  const me = page.me;
  const canInvite = Boolean(me?.referralUrl) && !ended;

  return (
    <div className="stack contest-page">
      <PageHeader title="Реферальный баттл" backHref="#/" />

      <section className="contest-hero" data-testid="contest-hero">
        <p className="contest-hero__pool">
          {formatAzcAmount(contest.prizePoolAzc)} 🪙
        </p>
        <p className="contest-hero__label">ПРИЗОВОЙ ФОНД</p>
        <p className="contest-hero__timer">
          {ended ? contestStatusLabel(contest.status) : formatCountdown(remaining)}
        </p>
        <p className="contest-hero__sub">
          {ended ? "Итоги зафиксированы" : "ДО КОНЦА КОНКУРСА"}
        </p>
      </section>

      <section className="card contest-prizes">
        <h2>Призы</h2>
        <ul>
          {contest.prizes.map((prize) => (
            <li key={prize.place} className="contest-prize-row">
              <span>
                {medalForPlace(prize.place)} {prize.place} место
              </span>
              <CoinAmount amount={prize.rewardAzc} size={16} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card contest-board">
        <h2>Рейтинг</h2>
        {page.leaderboard.length === 0 ? (
          <p className="muted">Пока никого нет. Пригласи друзей первым.</p>
        ) : (
          <ol className="contest-board__list">
            {page.leaderboard.map((row) => {
              const name = contestDisplayName(row);
              const top = row.rank <= 3;
              const prize = Boolean(row.rewardAzc);
              return (
                <li
                  key={`${row.rank}-${row.publicId ?? name}`}
                  className={[
                    "contest-board__row",
                    top ? "is-top3" : "",
                    prize ? "is-prize" : "",
                    row.isYou ? "is-you" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="contest-board__rank">{row.rank}</span>
                  <Avatar name={name} src={row.avatarUrl} size={36} />
                  <span className="contest-board__who">
                    <span className="contest-board__name">{name}</span>
                    {row.rewardAzc ? (
                      <span className="contest-board__reward">
                        {row.rank} место — {formatAzcAmount(row.rewardAzc)}
                      </span>
                    ) : null}
                  </span>
                  <span className="contest-board__score">{row.referralCount}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {me ? (
        <section className="card contest-me" data-testid="contest-me">
          <h2>Твоя позиция</h2>
          <p className="contest-me__rank">#{me.rank}</p>
          <p>Приглашено: {me.referralCount}</p>
          {myPositionHint(me) ? <p className="muted">{myPositionHint(me)}</p> : null}
          <button
            type="button"
            className="contest-invite"
            onClick={onInvite}
            disabled={!canInvite && !me.referralUrl}
            data-testid="contest-invite"
          >
            <IconTelegram size={18} />
            Пригласить друзей
          </button>
        </section>
      ) : null}
    </div>
  );
}
