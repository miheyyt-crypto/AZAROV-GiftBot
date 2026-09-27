import { AdminStatusBadge } from "./AdminStatusBadge.js";
import { formatAzcAmount } from "../lib/format.js";
import { contestDisplayName } from "../contest/parse.js";
import type {
  AdminReferralContestDetail,
  AdminReferralContestListItem,
} from "../contest/types.js";

export function AdminContestReferralView({
  items,
  prizes,
  startNow,
  startAt,
  note,
  submitting = false,
  detail,
  onPrizeChange,
  onStartNowChange,
  onStartAtChange,
  onCreate,
  onOpenDetail,
  onCloseDetail,
  onFinalize,
}: {
  items: AdminReferralContestListItem[];
  prizes: string[];
  startNow: boolean;
  startAt: string;
  note?: string;
  submitting?: boolean;
  detail: AdminReferralContestDetail | null;
  onPrizeChange: (index: number, value: string) => void;
  onStartNowChange: (value: boolean) => void;
  onStartAtChange: (value: string) => void;
  onCreate: () => void;
  onOpenDetail: (id: string) => void;
  onCloseDetail: () => void;
  onFinalize: () => void;
}) {
  const prizeSum = prizes.reduce((sum, value) => sum + (Number(value) || 0), 0);
  return (
    <div className="admin-stack">
      <form
        className="admin-card admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <p className="admin-form__legend">Новый реферальный конкурс</p>
        <p className="admin-field__hint">
          Фонд 100 000 AZC. Десять призовых мест (TOP 10). 1 место не больше
          25 000. Длительность 24 часа. Сумма призов должна быть ровно 100000.
        </p>
        {prizes.map((value, index) => (
          <label key={index} className="admin-field">
            {index + 1} место
            <input
              value={value}
              onChange={(event) => onPrizeChange(index, event.target.value)}
              inputMode="numeric"
            />
          </label>
        ))}
        <p className="admin-row__meta">Сумма: {prizeSum}</p>
        <label className="admin-field admin-field--row">
          <input
            type="checkbox"
            checked={startNow}
            onChange={(event) => onStartNowChange(event.target.checked)}
          />
          Запустить сейчас
        </label>
        {startNow ? null : (
          <label className="admin-field">
            startAt (UTC)
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => onStartAtChange(event.target.value)}
            />
          </label>
        )}
        <button
          type="submit"
          className="admin-btn admin-btn--primary"
          disabled={submitting}
        >
          Создать конкурс
        </button>
        {note ? <p className="admin-note">{note}</p> : null}
      </form>

      {items.length === 0 ? (
        <p className="admin-state">Конкурсов пока нет.</p>
      ) : (
        items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="admin-row admin-row--button"
            onClick={() => onOpenDetail(item.id)}
          >
            <div className="admin-row__body">
              <p className="admin-row__title">{item.title}</p>
              <p className="admin-row__meta">
                {item.status} · фонд {formatAzcAmount(item.prizePoolAzc)} ·
                участников {item.participantCount}
              </p>
            </div>
            <AdminStatusBadge status={item.status} />
          </button>
        ))
      )}

      {detail ? (
        <article className="admin-card">
          <p className="admin-row__title">{detail.contest.title}</p>
          <p className="admin-row__meta">
            {detail.contest.status} · {detail.contest.startAt} → {detail.contest.endAt}
          </p>
          <p className="admin-row__meta">
            Участников: {detail.participantCount}. Finalized:{" "}
            {detail.contest.finalizedAt ?? "нет"}
          </p>
          <ul>
            {detail.contest.prizes.map((prize) => (
              <li key={prize.place}>
                {prize.place}: {formatAzcAmount(prize.rewardAzc)}
              </li>
            ))}
          </ul>
          <ol>
            {detail.leaderboard.map((row) => (
              <li key={row.rank}>
                #{row.rank} {contestDisplayName(row)} — {row.referralCount}
              </li>
            ))}
          </ol>
          {detail.contest.finalizedAt ? null : (
            <button type="button" className="admin-btn" onClick={onFinalize}>
              Завершить / finalize
            </button>
          )}
          <button type="button" className="admin-btn" onClick={onCloseDetail}>
            Закрыть
          </button>
        </article>
      ) : null}
    </div>
  );
}
