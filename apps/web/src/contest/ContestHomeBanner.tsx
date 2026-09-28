import { Avatar } from "../components/Avatar.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { IconFriends, IconTelegram } from "../assets/icons.js";
import { contestDisplayName } from "./parse.js";
import {
  contestStatusLabel,
  formatCountdown,
  medalForPlace,
  remainingFromEndsAt,
} from "./messages.js";
import type { ReferralContestHomeSummary } from "./types.js";

function ContestTrophy({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 140"
      width="132"
      height="154"
      aria-hidden="true"
    >
      <ellipse cx="60" cy="128" rx="28" ry="6" fill="rgba(255, 189, 36, 0.28)" />
      <path
        d="M38 108h44c2 8-6 16-22 16s-24-8-22-16Z"
        fill="#c47a12"
        stroke="#ffd65a"
        strokeWidth="1.4"
      />
      <rect x="52" y="96" width="16" height="16" rx="3" fill="#ffbd24" />
      <path
        d="M28 22h64c4 0 10 4 10 14 0 28-18 52-42 52S18 64 18 36c0-10 6-14 10-14Z"
        fill="url(#contest-trophy-cup)"
        stroke="#ffe58a"
        strokeWidth="1.6"
      />
      <path
        d="M18 36c-14 2-18 16-10 28 8 12 22 10 28 6"
        fill="none"
        stroke="#ffd65a"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M102 36c14 2 18 16 10 28-8 12-22 10-28 6"
        fill="none"
        stroke="#ffd65a"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M40 30c8-8 32-10 42 2"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="60" cy="54" r="8" fill="#fff3c4" opacity="0.55" />
      <defs>
        <linearGradient id="contest-trophy-cup" x1="28" y1="18" x2="86" y2="88">
          <stop offset="0%" stopColor="#fff1a8" />
          <stop offset="45%" stopColor="#ffbd24" />
          <stop offset="100%" stopColor="#ff9f0a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg
      className="contest-home-banner__clock"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 7.4v5.1l3.4 1.9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlaceBadge({ place }: { place: number }) {
  const tone = place <= 3 ? `contest-home-banner__badge--${place}` : "contest-home-banner__badge--rest";
  return <span className={`contest-home-banner__badge ${tone}`}>{medalForPlace(place)}</span>;
}

export function ContestHomeBanner({
  page,
  fetchedAtMs,
  nowMs,
  onInvite,
}: {
  page: ReferralContestHomeSummary;
  fetchedAtMs: number;
  nowMs: number;
  onInvite: () => void;
}) {
  const contest = page.contest;
  if (!contest) {
    return null;
  }

  const remaining = remainingFromEndsAt(
    contest.endAt,
    contest.serverNow,
    fetchedAtMs,
    nowMs,
  );
  const ended =
    contest.status === "ended" ||
    contest.status === "finalized" ||
    remaining <= 0;
  const canInvite = Boolean(page.me.referralUrl) && !ended;
  const placeLabel = page.me.rank > 0 ? `#${page.me.rank}` : "—";
  const placeHot = page.me.rank > 0 && page.me.rank <= 5;
  const endedLabel = contestStatusLabel(
    contest.status === "active" && remaining <= 0 ? "ended" : contest.status,
  );

  return (
    <section className="contest-home-banner" data-testid="contest-home-banner">
      <span className="contest-home-banner__spark" aria-hidden="true" />
      <span className="contest-home-banner__spark contest-home-banner__spark--2" aria-hidden="true" />
      <span className="contest-home-banner__spark contest-home-banner__spark--3" aria-hidden="true" />
      <span className="contest-home-banner__orb" aria-hidden="true" />
      <span className="contest-home-banner__orb contest-home-banner__orb--floor" aria-hidden="true" />

      <div className="contest-home-banner__hero">
        <div className="contest-home-banner__titles">
          <p className="contest-home-banner__kicker">🏆 РЕФЕРАЛЬНЫЙ</p>
          <h2 className="contest-home-banner__title">БАТТЛ</h2>
        </div>
        <div className="contest-home-banner__trophy-wrap" aria-hidden="true">
          <span className="contest-home-banner__coin contest-home-banner__coin--a" />
          <span className="contest-home-banner__coin contest-home-banner__coin--b" />
          <span className="contest-home-banner__coin contest-home-banner__coin--c" />
          <span className="contest-home-banner__star contest-home-banner__star--a" />
          <span className="contest-home-banner__star contest-home-banner__star--b" />
          <span className="contest-home-banner__star contest-home-banner__star--c" />
          <ContestTrophy className="contest-home-banner__trophy" />
        </div>
      </div>

      <div
        className={
          ended
            ? "contest-home-banner__timer-card is-ended"
            : "contest-home-banner__timer-card"
        }
      >
        <ClockGlyph />
        {ended ? (
          <div className="contest-home-banner__ended" aria-label={endedLabel}>
            <span>КОНКУРС</span>
            <strong>ЗАВЕРШЁН</strong>
          </div>
        ) : (
          <div className="contest-home-banner__until-block">
            <span className="contest-home-banner__until">До конца</span>
            <p className="contest-home-banner__timer">{formatCountdown(remaining)}</p>
          </div>
        )}
      </div>

      <div className="contest-home-banner__grid">
        <div className="contest-home-banner__col">
          <p className="contest-home-banner__section">ПРИЗЫ</p>
          <ul className="contest-home-banner__prizes">
            {contest.prizes.map((prize) => (
              <li
                key={prize.place}
                className={`contest-home-banner__prize contest-home-banner__prize--${prize.place}`}
              >
                <PlaceBadge place={prize.place} />
                <CoinAmount amount={prize.rewardAzc} size={18} />
              </li>
            ))}
          </ul>
        </div>

        <div className="contest-home-banner__col">
          <p className="contest-home-banner__section">ТВОЯ СТАТИСТИКА</p>
          <div className="contest-home-banner__stats">
            <div className="contest-home-banner__stat">
              <p className="contest-home-banner__stat-label">
                <IconFriends size={14} />
                Приглашено
              </p>
              <strong>{page.me.referralCount}</strong>
            </div>
            <div className={placeHot ? "contest-home-banner__stat is-hot" : "contest-home-banner__stat"}>
              <p className="contest-home-banner__stat-label">
                <span className="contest-home-banner__stat-trophy" aria-hidden="true">
                  🏆
                </span>
                Твоё место
              </p>
              <strong>{placeLabel}</strong>
            </div>
          </div>

          <p className="contest-home-banner__section">TOP 5</p>
          <p className="contest-home-banner__rule">Приз от 5 активных рефералов</p>
          {page.leaderboard.length === 0 ? (
            <div className="contest-home-banner__empty">
              <IconFriends size={22} />
              <p>Пока никто не пригласил друзей</p>
              <strong>Стань первым!</strong>
            </div>
          ) : (
            <ol className="contest-home-banner__board">
              {page.leaderboard.map((row) => {
                const name = contestDisplayName(row);
                return (
                  <li key={row.rank} className={row.isYou ? "is-you" : undefined}>
                    <PlaceBadge place={row.rank} />
                    <span className="contest-home-banner__avatar">
                      <Avatar name={name} src={row.avatarUrl} size={30} />
                    </span>
                    <span className="contest-home-banner__name">
                      {name}
                      {row.isYou ? <em> (Ты)</em> : null}
                    </span>
                    <span className="contest-home-banner__count">
                      <IconFriends size={11} />
                      {row.referralCount}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      {canInvite ? (
        <button
          type="button"
          className="contest-home-banner__invite"
          onClick={onInvite}
        >
          <IconTelegram size={20} />
          Пригласить друзей
        </button>
      ) : null}
    </section>
  );
}
