import { AdminImageField } from "./AdminImageField.js";
import { AdminStatusBadge } from "./AdminStatusBadge.js";
import {
  broadcastStatusLabel,
  type AdminBroadcastItem,
} from "./broadcast-parse.js";

export function AdminBroadcastView({
  message,
  photoName,
  photoPreviewUrl,
  buttonEnabled,
  buttonKind,
  buttonText,
  buttonUrl,
  recipientCount,
  items,
  active,
  submitting,
  note,
  onMessageChange,
  onPhotoFile,
  onPhotoClear,
  onButtonEnabledChange,
  onButtonKindChange,
  onButtonTextChange,
  onButtonUrlChange,
  onSend,
  onOpen,
}: {
  message: string;
  photoName: string | null;
  photoPreviewUrl: string | null;
  buttonEnabled: boolean;
  buttonKind: "url" | "web_app";
  buttonText: string;
  buttonUrl: string;
  recipientCount: number;
  items: AdminBroadcastItem[];
  active: AdminBroadcastItem | null;
  submitting?: boolean;
  note?: string;
  onMessageChange: (value: string) => void;
  onPhotoFile: (file: File) => void;
  onPhotoClear: () => void;
  onButtonEnabledChange: (value: boolean) => void;
  onButtonKindChange: (value: "url" | "web_app") => void;
  onButtonTextChange: (value: string) => void;
  onButtonUrlChange: (value: string) => void;
  onSend: () => void;
  onOpen: (id: string) => void;
}) {
  const progress =
    active && active.recipientCount > 0
      ? Math.round((active.sentCount / active.recipientCount) * 100)
      : 0;
  return (
    <div className="admin-stack">
      <form
        className="admin-card admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <p className="admin-form__legend">Рассылка в Telegram</p>
        <label className="admin-field">
          Сообщение
          <textarea
            rows={8}
            value={message}
            placeholder="Напишите текст..."
            onChange={(event) => onMessageChange(event.target.value)}
          />
        </label>
        <p className="admin-field__hint">
          HTML: b, i, u, s, code, a href. Переносы строк сохраняются.
        </p>
        <div className="admin-form__section">
          <p className="admin-form__legend">Фото</p>
          <AdminImageField
            previewUrl={photoPreviewUrl}
            disabled={submitting === true}
            onFile={onPhotoFile}
            onClear={onPhotoClear}
          />
          {photoName ? <p className="admin-row__meta">{photoName}</p> : null}
        </div>
        <label className="admin-field admin-field--row">
          <input
            type="checkbox"
            checked={buttonEnabled}
            onChange={(event) => onButtonEnabledChange(event.target.checked)}
          />
          Добавить кнопку
        </label>
        {buttonEnabled ? (
          <>
            <label className="admin-field">
              Текст кнопки
              <input
                value={buttonText}
                onChange={(event) => onButtonTextChange(event.target.value)}
              />
            </label>
            <label className="admin-field">
              Ссылка
              <input
                value={buttonUrl}
                onChange={(event) => onButtonUrlChange(event.target.value)}
              />
            </label>
            <label className="admin-field">
              Тип
              <select
                value={buttonKind}
                onChange={(event) =>
                  onButtonKindChange(event.target.value === "web_app" ? "web_app" : "url")
                }
              >
                <option value="url">URL</option>
                <option value="web_app">Web App</option>
              </select>
            </label>
          </>
        ) : null}
        <section className="admin-broadcast-preview" aria-label="Telegram preview">
          <p className="admin-form__legend">Preview</p>
          {photoPreviewUrl ? (
            <img src={photoPreviewUrl} alt="" className="admin-broadcast-preview__photo" />
          ) : null}
          <p className="admin-broadcast-preview__text">{message || "Напишите текст..."}</p>
          {buttonEnabled && buttonText ? (
            <span className="admin-broadcast-preview__btn">{buttonText}</span>
          ) : null}
        </section>
        <p className="admin-row__meta">Получателей: {recipientCount}</p>
        <button type="submit" className="admin-btn admin-btn--primary" disabled={submitting}>
          Отправить всем
        </button>
        {note ? <p className="admin-note">{note}</p> : null}
      </form>
      {active ? (
        <article className="admin-card">
          <p className="admin-row__title">Рассылка #{active.id.slice(0, 8)}</p>
          <AdminStatusBadge
            status={active.status === "sending" ? "processing" : active.status}
            label={broadcastStatusLabel(active.status)}
          />
          <p className="admin-row__meta">
            Получателей: {active.recipientCount} · Отправлено: {active.sentCount} ·
            Ошибок: {active.failedCount}
          </p>
          <div className="admin-broadcast-bar" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="admin-row__meta">
            {active.sentCount} / {active.recipientCount}
          </p>
        </article>
      ) : null}
      {items.length === 0 ? (
        <p className="admin-state">Рассылок пока нет.</p>
      ) : (
        items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="admin-row admin-row--button"
            onClick={() => onOpen(item.id)}
          >
            <div className="admin-row__body">
              <p className="admin-row__title">{item.messagePreview || "—"}</p>
              <p className="admin-row__meta">
                {new Date(item.createdAt).toLocaleString("ru-RU")} ·{" "}
                {item.hasPhoto ? "фото да" : "фото нет"} · {item.recipientCount} получателей ·
                доставлено {item.sentCount} · ошибок {item.failedCount}
              </p>
            </div>
            <AdminStatusBadge
              status={item.status === "sending" ? "processing" : item.status}
              label={broadcastStatusLabel(item.status)}
            />
          </button>
        ))
      )}
    </div>
  );
}
