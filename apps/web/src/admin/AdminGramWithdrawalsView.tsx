import { formatGramAmount } from "../lib/format.js";
import { friendlyGramStatus } from "../profile/gram-messages.js";
import type { AdminGramWithdrawal, GramWithdrawalStatus } from "../profile/types.js";

export function AdminGramWithdrawalsView({
  items,
  status,
  reason,
  note,
  submitting = false,
  onStatusChange,
  onReasonChange,
  onProcess,
  onFulfill,
  onReject,
}: {
  items: AdminGramWithdrawal[];
  status: GramWithdrawalStatus | "all";
  reason: string;
  note?: string;
  submitting?: boolean;
  onStatusChange: (status: GramWithdrawalStatus | "all") => void;
  onReasonChange: (value: string) => void;
  onProcess: (id: string) => void;
  onFulfill: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const filters: Array<{ id: GramWithdrawalStatus | "all"; label: string }> = [
    { id: "all", label: "Все" },
    { id: "pending", label: "Ожидает" },
    { id: "processing", label: "В обработке" },
    { id: "fulfilled", label: "Выполнено" },
    { id: "rejected", label: "Отклонено" },
  ];

  return (
    <div className="stack">
      <div className="seg-tabs" role="tablist">
        {filters.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={option.id === status}
            className={option.id === status ? "seg-tabs__item is-active" : "seg-tabs__item"}
            onClick={() => onStatusChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="field">
        Причина отклонения
        <input value={reason} onChange={(event) => onReasonChange(event.target.value)} />
      </label>
      {note ? <p className="muted">{note}</p> : null}
      {items.length === 0 ? (
        <p className="muted">Заявок нет.</p>
      ) : (
        items.map((item) => (
          <article key={item.id} className="card stack">
            <p className="mini-row__title">{item.user ?? item.id}</p>
            <p>@{item.telegramUsername.replace(/^@/, "")}</p>
            <p>{formatGramAmount(item.amountGram)}</p>
            <p>{friendlyGramStatus(item.status)}</p>
            <p className="muted">{new Date(item.createdAt).toLocaleString("ru-RU")}</p>
            {item.rejectionReason ? <p className="muted">{item.rejectionReason}</p> : null}
            {item.status === "pending" || item.status === "processing" ? (
              <div className="stack">
                {item.status === "pending" ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => onProcess(item.id)}
                  >
                    В обработку
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => onFulfill(item.id)}
                >
                  Выполнено
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => onReject(item.id)}
                >
                  Отклонить
                </button>
              </div>
            ) : null}
          </article>
        ))
      )}
    </div>
  );
}
