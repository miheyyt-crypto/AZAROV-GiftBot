import { ProgressBar } from "../components/ProgressBar.js";
import { IconFlame } from "../assets/icons.js";
import { CoinAmount } from "../components/CoinAmount.js";
import type { StreamStreakState } from "./types.js";

const HINT = "Напиши 10 сообщений в чат, чтобы стрик засчитался";

export function StreamStreakCard({ streak }: { streak: StreamStreakState }) {
  const title = `${String(streak.currentStreak)} стримов подряд`;
  const progressCurrent = streak.completed ? 10 : streak.currentStreak;
  const progressMax = streak.completed
    ? 10
    : (streak.nextTarget ?? Math.max(streak.currentStreak + 1, 1));

  return (
    <section className="card streak-card">
      <div className="streak-card__row">
        <div className="streak-card__icon" aria-hidden="true">
          <IconFlame size={24} />
        </div>
        <div className="streak-card__body">
          <h2 className="streak-card__title">{title}</h2>
          {streak.completed ? (
            <p className="streak-card__bonus">Серия завершена</p>
          ) : (
            <p className="streak-card__bonus">
              Следующий бонус:{" "}
              {streak.nextRewardAzc ? (
                <CoinAmount amount={streak.nextRewardAzc} sign="plus" size={14} />
              ) : (
                "—"
              )}
            </p>
          )}
          <div className="streak-card__progress">
            <ProgressBar value={progressCurrent} max={progressMax} tone="gold" />
            <span className="streak-card__ratio">
              {progressCurrent}/{progressMax}
            </span>
          </div>
        </div>
      </div>
      {streak.stream.isLive ? (
        <>
          <p className="muted streak-card__hint">
            Эфир: {streak.stream.messages}/{streak.stream.requiredMessages}
            {streak.stream.qualified ? " — Стрим засчитан" : ""}
          </p>
          <ProgressBar
            value={Math.min(streak.stream.messages, streak.stream.requiredMessages)}
            max={streak.stream.requiredMessages}
          />
        </>
      ) : (
        <p className="muted streak-card__hint">{HINT}</p>
      )}
    </section>
  );
}
