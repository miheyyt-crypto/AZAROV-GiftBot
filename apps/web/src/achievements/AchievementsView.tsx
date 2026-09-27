import { EmptyState } from "../components/EmptyState.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { CoinAmount } from "../components/CoinAmount.js";
import type { AchievementCode, AchievementListItem } from "./types.js";

function AchievementGlyph({ code }: { code: AchievementCode }) {
  if (code === "kick_100_messages") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5.2 6.4h13.6v9.4a1.6 1.6 0 0 1-1.6 1.6H10.2L6 20v-2.6H5.2A1.6 1.6 0 0 1 3.6 15.8V8A1.6 1.6 0 0 1 5.2 6.4Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (code === "referrals_5_active") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 18.4c.5-3.2 2.6-5 5-5s4.5 1.8 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="16.4" cy="8.6" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (code === "games_100_total") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="7" width="16" height="10" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 12h2M9 11v2M14.5 11.2v.2M16.5 12.8v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (code === "cases_25_opened") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 10h14v8.2A1.8 1.8 0 0 1 17.2 20H6.8A1.8 1.8 0 0 1 5 18.2V10Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5 10 7.2 5.6h9.6L19 10" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="14" r="5.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.2 9.4 8 4.6h8L14.8 9.4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function AchievementsView({ items }: { items: AchievementListItem[] }) {
  if (items.length === 0) {
    return <EmptyState title="Пусто" text="Достижения появятся здесь." />;
  }

  return (
    <div className="stack ach-list">
      {items.map((item) => {
        const received = item.completed || item.unlockedAt != null;
        return (
          <article
            key={item.code}
            className={received ? "ach-card is-done" : "ach-card"}
            data-testid="achievement-card"
            data-code={item.code}
          >
            <div className="ach-card__top">
              <span className="ach-card__tile">
                <AchievementGlyph code={item.code} />
              </span>
              <p className="ach-card__title">{item.title}</p>
              <span className="ach-card__reward">
                <CoinAmount amount={item.rewardAzc} size={14} />
              </span>
            </div>
            <ProgressBar value={item.current} max={item.target} />
            <p className="ach-card__progress">
              {String(item.current)}/{String(item.target)}
            </p>
            {received ? (
              <p className="ach-card__state">✓ Награда получена</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
