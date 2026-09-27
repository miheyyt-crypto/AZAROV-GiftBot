import type {
  GiveawayAdminDetail,
  GiveawayAdminListItem,
  GiveawayDbStatus,
  GiveawayType,
} from "../giveaways/types.js";
import { BottomSheet } from "../components/BottomSheet.js";
import { formatAzcAmount } from "../lib/format.js";
import { AdminImageField } from "./AdminImageField.js";
import { AdminStatusBadge } from "./AdminStatusBadge.js";

const FILTERS: Array<{ id: GiveawayDbStatus | "all"; label: string }> = [
  { id: "all", label: "Все" },
  { id: "open", label: "Активные" },
  { id: "settled", label: "Завершённые" },
  { id: "draft", label: "Черновики" },
  { id: "cancelled", label: "Отменённые" },
];

export function AdminGiveawaysView({
  items,
  statusFilter,
  title,
  type,
  bankAzc,
  customPrize,
  winnerCount,
  endsAt,
  reason,
  imagePreviewUrl,
  note,
  submitting = false,
  creating = false,
  detail,
  detailReason,
  onStatusFilterChange,
  onTitleChange,
  onTypeChange,
  onBankChange,
  onCustomPrizeChange,
  onWinnerCountChange,
  onEndsAtChange,
  onReasonChange,
  onImageFile,
  onImageClear,
  onToggleCreate,
  onCreate,
  onActivate,
  onCancel,
  onOpenDetail,
  onCloseDetail,
  onDetailReasonChange,
  onDeliver,
  onSaveDraftImage,
}: {
  items: GiveawayAdminListItem[];
  statusFilter: GiveawayDbStatus | "all";
  title: string;
  type: GiveawayType;
  bankAzc: string;
  customPrize: string;
  winnerCount: string;
  endsAt: string;
  reason: string;
  imagePreviewUrl: string | null;
  note?: string;
  submitting?: boolean;
  creating?: boolean;
  detail: GiveawayAdminDetail | null;
  detailReason: string;
  onStatusFilterChange: (status: GiveawayDbStatus | "all") => void;
  onTitleChange: (value: string) => void;
  onTypeChange: (value: GiveawayType) => void;
  onBankChange: (value: string) => void;
  onCustomPrizeChange: (value: string) => void;
  onWinnerCountChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onImageFile: (file: File) => void;
  onImageClear: () => void;
  onToggleCreate: () => void;
  onCreate: () => void;
  onActivate: (id: string) => void;
  onCancel: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onCloseDetail: () => void;
  onDetailReasonChange: (value: string) => void;
  onDeliver: (giveawayId: string, winnerUserId: string) => void;
  onSaveDraftImage?: (id: string) => void;
}) {
  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <div className="admin-seg" role="tablist">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={option.id === statusFilter}
              className={
                option.id === statusFilter ? "admin-seg__item is-active" : "admin-seg__item"
              }
              onClick={() => onStatusFilterChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="admin-btn admin-btn--primary" onClick={onToggleCreate}>
          {creating ? "Скрыть форму" : "+ Создать розыгрыш"}
        </button>
      </div>

      {creating ? (
        <form
          className="admin-card admin-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
        >
          <section className="admin-form__section">
            <p className="admin-form__legend">Основное</p>
            <label className="admin-field">
              Название
              <input value={title} onChange={(event) => onTitleChange(event.target.value)} />
            </label>
          </section>
          <section className="admin-form__section">
            <p className="admin-form__legend">Изображение</p>
            <p className="admin-field__hint">Необязательно. PNG, JPG или WEBP.</p>
            <AdminImageField
              previewUrl={imagePreviewUrl}
              disabled={submitting}
              onFile={onImageFile}
              onClear={onImageClear}
            />
          </section>
          <section className="admin-form__section">
            <p className="admin-form__legend">Награда</p>
            <label className="admin-field">
              Тип
              <select
                value={type}
                onChange={(event) => onTypeChange(event.target.value as GiveawayType)}
              >
                <option value="coins">Монеты</option>
                <option value="custom_prize">Кастомный приз</option>
              </select>
            </label>
            {type === "coins" ? (
              <label className="admin-field">
                Банк AZC
                <input
                  value={bankAzc}
                  onChange={(event) => onBankChange(event.target.value)}
                />
              </label>
            ) : (
              <label className="admin-field">
                Приз
                <input
                  value={customPrize}
                  onChange={(event) => onCustomPrizeChange(event.target.value)}
                />
              </label>
            )}
          </section>
          <section className="admin-form__section">
            <p className="admin-form__legend">Победители и сроки</p>
            <label className="admin-field">
              Число победителей
              <input
                value={winnerCount}
                onChange={(event) => onWinnerCountChange(event.target.value)}
              />
            </label>
            <label className="admin-field">
              Окончание (ISO, опционально)
              <span className="admin-field__hint">Условие: привязанный Kick</span>
              <input
                value={endsAt}
                onChange={(event) => onEndsAtChange(event.target.value)}
                placeholder="2026-12-31T23:59:00.000Z"
              />
            </label>
          </section>
          {title.trim() ? (
            <section className="admin-form__section">
              <p className="admin-form__legend">Preview</p>
              <article className="giveaway-card is-live admin-giveaway-preview">
                {imagePreviewUrl ? (
                  <div className="giveaway-card__media giveaway-card__media--home">
                    <img src={imagePreviewUrl} alt="" />
                  </div>
                ) : null}
                <p className="giveaway-card__title">{title.trim()}</p>
                <p className="giveaway-card__prize">
                  {type === "coins" ? bankAzc || "—" : customPrize || "—"}
                </p>
              </article>
            </section>
          ) : null}
          <label className="admin-field">
            Причина
            <input value={reason} onChange={(event) => onReasonChange(event.target.value)} />
          </label>
          <button type="submit" className="admin-btn admin-btn--primary" disabled={submitting}>
            Создать розыгрыш
          </button>
          {note ? <p className="admin-note">{note}</p> : null}
        </form>
      ) : note ? (
        <p className="admin-note">{note}</p>
      ) : null}

      {items.length === 0 ? (
        <p className="admin-state">Розыгрышей пока нет.</p>
      ) : (
        <div className="admin-table-wrap">
          {items.map((item) => (
            <article key={item.id} className="admin-row">
              {item.imageUrl ? (
                <img className="admin-row__thumb" src={item.imageUrl} alt="" />
              ) : (
                <div className="admin-row__thumb admin-row__thumb--empty" />
              )}
              <div className="admin-row__body">
                <p className="admin-row__title">{item.title}</p>
                <p className="admin-row__meta">
                  {item.type === "coins" && item.bankAzc
                    ? formatAzcAmount(item.bankAzc)
                    : item.customPrize ?? "—"}
                  {" · "}участников {item.participantCount}
                  {" · "}победителей {item.winnerCount}
                </p>
                <p className="admin-row__meta">
                  {item.endsAt
                    ? new Date(item.endsAt).toLocaleString("ru-RU")
                    : "без срока"}
                </p>
              </div>
              <AdminStatusBadge status={item.status} />
              <div className="admin-row__actions">
                <button
                  type="button"
                  className="admin-btn admin-btn--secondary"
                  onClick={() => onOpenDetail(item.id)}
                  disabled={submitting}
                >
                  Открыть
                </button>
                {item.status === "draft" ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn--success"
                    onClick={() => onActivate(item.id)}
                    disabled={submitting}
                  >
                    Активировать
                  </button>
                ) : null}
                {item.status === "draft" || item.status === "open" || item.status === "closed" ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn--danger"
                    onClick={() => onCancel(item.id)}
                    disabled={submitting}
                  >
                    Отменить
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <BottomSheet
        open={detail != null}
        title={detail?.giveaway.title ?? "Розыгрыш"}
        onClose={onCloseDetail}
      >
        {detail ? (
          <div className="admin-stack">
            {detail.giveaway.imageUrl ? (
              <img className="admin-detail-photo" src={detail.giveaway.imageUrl} alt="" />
            ) : null}
            <p className="muted">
              {detail.giveaway.status} · участников {detail.giveaway.participantCount}
            </p>
            {detail.giveaway.status === "draft" && onSaveDraftImage ? (
              <button
                type="button"
                className="admin-btn admin-btn--secondary"
                disabled={submitting}
                onClick={() => onSaveDraftImage(detail.giveaway.id)}
              >
                Сохранить изображение черновика
              </button>
            ) : null}
            <p className="eyebrow">Победители</p>
            {detail.winners.length === 0 ? (
              <p className="muted">Пока нет</p>
            ) : (
              detail.winners.map((winner) => (
                <div key={winner.userId} className="mini-row">
                  <div>
                    <p className="mini-row__title">{winner.publicId}</p>
                    <p className="muted">
                      {winner.prizeAzc
                        ? formatAzcAmount(winner.prizeAzc)
                        : winner.prizeText ?? "—"}{" "}
                      · {winner.deliveryStatus ?? "—"}
                    </p>
                  </div>
                  {detail.giveaway.type === "custom_prize" &&
                  winner.deliveryStatus === "pending_delivery" ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--success"
                      disabled={submitting}
                      onClick={() => onDeliver(detail.giveaway.id, winner.userId)}
                    >
                      Выдано
                    </button>
                  ) : null}
                </div>
              ))
            )}
            <label className="admin-field">
              Причина для действий
              <input
                value={detailReason}
                onChange={(event) => onDetailReasonChange(event.target.value)}
              />
            </label>
            <p className="eyebrow">Участники</p>
            {detail.participants.length === 0 ? (
              <p className="muted">Участников нет</p>
            ) : (
              detail.participants.map((p) => (
                <p key={p.entryId} className="muted">
                  {p.publicId}
                  {p.isWinner ? " · победитель" : ""} · {p.status}
                </p>
              ))
            )}
          </div>
        ) : null}
      </BottomSheet>
    </div>
  );
}
