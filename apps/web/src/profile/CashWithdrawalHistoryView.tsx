import { formatRubAmount, formatShortDateTime } from "../lib/format.js";
import {
  friendlyCashSource,
  friendlyCashStatus,
} from "./cash-messages.js";
import type { CashItemWithdrawal } from "./types.js";

export function CashWithdrawalHistoryView({
  items,
}: {
  items: CashItemWithdrawal[];
}) {
  if (items.length === 0) {
    return <p className="muted">Заявок пока нет.</p>;
  }
  return (
    <div className="stack ops-list">
      {items.map((item) => (
        <article key={item.id} className={`ops-card ops-card--${item.status}`}>
          <span className="ops-card__tile" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="7" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8 7V6.2A2.2 2.2 0 0 1 10.2 4h3.6A2.2 2.2 0 0 1 16 6.2V7" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </span>
          <div className="ops-card__copy">
            <div className="ops-card__row">
              <p className="ops-card__amount">{formatRubAmount(item.amountRub)}</p>
              <p className="ops-card__date">{formatShortDateTime(item.createdAt)}</p>
            </div>
            <p className="ops-card__label">{friendlyCashSource(item.source)}</p>
            <p className={`ops-card__status ops-card__status--${item.status}`}>
              {friendlyCashStatus(item.status)}
            </p>
            {item.status === "rejected" && item.rejectionReason ? (
              <p className="ops-card__reason">{item.rejectionReason}</p>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
