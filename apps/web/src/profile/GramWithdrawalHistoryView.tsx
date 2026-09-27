import { formatGramAmount } from "../lib/format.js";
import { friendlyGramStatus } from "../profile/gram-messages.js";
import type { GramWithdrawal } from "../profile/types.js";

export function GramWithdrawalHistoryView({ items }: { items: GramWithdrawal[] }) {
  if (items.length === 0) {
    return <p className="muted">Заявок пока нет.</p>;
  }
  return (
    <div className="stack">
      {items.map((item) => (
        <article key={item.id} className="card stack">
          <p className="mini-row__title">{formatGramAmount(item.amountGram)}</p>
          <p>@{item.telegramUsername.replace(/^@/, "")}</p>
          <p>{friendlyGramStatus(item.status)}</p>
          <p className="muted">{new Date(item.createdAt).toLocaleString("ru-RU")}</p>
          {item.status === "rejected" && item.rejectionReason ? (
            <p className="muted">{item.rejectionReason}</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}
