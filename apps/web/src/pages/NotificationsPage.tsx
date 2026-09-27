import { BottomSheet } from "../components/BottomSheet.js";
import { QueryPanel } from "../components/QueryPanel.js";
import { EmptyState } from "../components/EmptyState.js";
import { navigate } from "../app/routes.js";
import { formatRelativeTime } from "../free-case/messages.js";
import { parseProfileNotifications } from "../profile/parse.js";
import { notificationAccent } from "../profile/profile-ui.js";
import { NoticeCopy } from "../profile/NoticeCopy.js";
import { EMPTY_PROFILE_LIST } from "../profile/types.js";
import type { ProfileNotification } from "../profile/types.js";
import { useAuthedGet } from "../profile/useAuthedGet.js";

function NoteGlyph({ accent }: { accent: "gold" | "red" | "green" | "violet" }) {
  if (accent === "red") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 8v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="16.2" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  if (accent === "green") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8.4 12.2 10.8 14.6 15.6 9.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.4 9.4a5.6 5.6 0 0 1 11.2 0c0 4.2 1.4 5.6 1.4 5.6H5s1.4-1.4 1.4-5.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10 18.4a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function NotificationsList({ items }: { items: ProfileNotification[] }) {
  const unread = items.filter((item) => item.readAt == null).length;
  return (
    <div className="stack psheet-stack">
      <div className="note-toolbar">
        <p className="note-toolbar__count">Непрочитанных: {String(unread)}</p>
      </div>
      {items.map((item) => {
        const unreadItem = item.readAt == null;
        const accent = notificationAccent(item.type);
        return (
          <article
            key={item.id}
            className={unreadItem ? `note-card note-card--${accent} is-unread` : `note-card note-card--${accent}`}
            data-type={item.type}
          >
            <span className={`note-card__tile note-card__tile--${accent}`}>
              <NoteGlyph accent={accent} />
            </span>
            <div className="note-card__copy">
              <p className="note-card__title">
                <NoticeCopy text={item.title} />
              </p>
              <p className="note-card__body">
                <NoticeCopy text={item.body} />
              </p>
              <p className="note-card__time">{formatRelativeTime(item.createdAt, Date.now())}</p>
            </div>
            {unreadItem ? <span className="note-card__dot" aria-label="Непрочитано" /> : null}
          </article>
        );
      })}
    </div>
  );
}

export function NotificationsPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  const query = useAuthedGet(
    token,
    "/profile/notifications",
    parseProfileNotifications,
    !skipRemote,
    EMPTY_PROFILE_LIST,
    false,
  );
  const items = query.status === "ready" ? query.data.items : [];

  return (
    <BottomSheet
      open
      title="Уведомления"
      className="sheet--profile"
      onClose={() => navigate("#/profile")}
    >
      <QueryPanel
        status={query.status}
        {...(query.status === "error" ? { errorMessage: query.message } : {})}
        onRetry={query.retry}
        loadingLabel="Загрузка уведомлений"
      >
        {query.status === "ready" && items.length === 0 ? (
          <div className="psheet-empty">
            <span className="psheet-empty__icon" aria-hidden="true">
              <NoteGlyph accent="gold" />
            </span>
            <EmptyState title="Уведомлений пока нет" text="Когда появятся события, они отобразятся здесь." />
          </div>
        ) : null}
        {query.status === "ready" && items.length > 0 ? <NotificationsList items={items} /> : null}
      </QueryPanel>
    </BottomSheet>
  );
}

export default NotificationsPage;
