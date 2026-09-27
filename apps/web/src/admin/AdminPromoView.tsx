import { AdminStatusBadge } from "./AdminStatusBadge.js";

export type AdminPromoItemView = {
  id: string;
  code: string;
  reward: string;
  used: number;
  limit: number;
  status: "active" | "inactive";
  createdAt: string;
  deactivatedAt: string | null;
};

export function AdminPromoView({
  items,
  code,
  rewardAzc,
  activationLimit,
  note,
  submitting = false,
  onCodeChange,
  onRewardChange,
  onLimitChange,
  onCreate,
  onDeactivate,
}: {
  items: AdminPromoItemView[];
  code: string;
  rewardAzc: string;
  activationLimit: string;
  note?: string;
  submitting?: boolean;
  onCodeChange: (value: string) => void;
  onRewardChange: (value: string) => void;
  onLimitChange: (value: string) => void;
  onCreate: () => void;
  onDeactivate: (id: string) => void;
}) {
  return (
    <div className="admin-stack">
      <form
        className="admin-card admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <p className="admin-form__legend">Новый промокод</p>
        <label className="admin-field">
          Код
          <input value={code} onChange={(event) => onCodeChange(event.target.value)} />
        </label>
        <label className="admin-field">
          Награда AZC
          <input
            value={rewardAzc}
            onChange={(event) => onRewardChange(event.target.value)}
          />
        </label>
        <label className="admin-field">
          Лимит активаций
          <input
            value={activationLimit}
            onChange={(event) => onLimitChange(event.target.value)}
          />
        </label>
        <button type="submit" className="admin-btn admin-btn--primary" disabled={submitting}>
          Создать
        </button>
        {note ? <p className="admin-note">{note}</p> : null}
      </form>
      {items.length === 0 ? (
        <p className="admin-state">Промокодов пока нет.</p>
      ) : (
        items.map((item) => (
          <article key={item.id} className="admin-row">
            <div className="admin-row__body">
              <p className="admin-row__title">{item.code}</p>
              <p className="admin-row__meta">
                {item.reward} AZC · {item.used}/{item.limit} · {item.status}
              </p>
              <p className="admin-row__meta">
                {new Date(item.createdAt).toLocaleString("ru-RU")}
              </p>
            </div>
            <div className="admin-row__actions">
              <AdminStatusBadge
                status={item.status}
                label={item.status === "active" ? "active" : "inactive"}
              />
              {item.status === "active" ? (
                <button
                  type="button"
                  className="admin-btn admin-btn--danger"
                  onClick={() => onDeactivate(item.id)}
                  disabled={submitting}
                >
                  Деактивировать
                </button>
              ) : (
                <p className="muted">Неактивен</p>
              )}
            </div>
          </article>
        ))
      )}
    </div>
  );
}
