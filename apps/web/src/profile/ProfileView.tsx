import { Avatar } from "../components/Avatar.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { BottomSheet } from "../components/BottomSheet.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { CookieArt } from "../components/WelvuraBanner.js";
import { navigate } from "../app/routes.js";
import { formatGramAmount, groupDigits } from "../lib/format.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { IconCoin, IconFlame, IconGram } from "../assets/icons.js";
import type { ProfileSummary } from "./types.js";

function MenuIconBell() {
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

function MenuIconHistory() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.6V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MenuIconReceipt() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4.6h10v15.2l-2.2-1.3-2.8 1.6-2.8-1.6L7 19.8V4.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.4 9h5.2M9.4 12.2h5.2M9.4 15.4h3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MenuIconCube() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.4 19 8.2v7.6L12 19.6 5 15.8V8.2L12 4.4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 19.6V12M5 8.2 12 12l7-3.8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIconBag() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 9h10v10.2A1.8 1.8 0 0 1 15.2 21H8.8A1.8 1.8 0 0 1 7 19.2V9Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.4 9V7.2a2.6 2.6 0 0 1 5.2 0V9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MenuIconMedal() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="14" r="5.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.2 9.4 8 4.6h8L14.8 9.4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function MenuIconHeadset() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5.6 12.2V11a6.4 6.4 0 0 1 12.8 0v1.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5.6 12.4h2.2v5.2H5.6A1.6 1.6 0 0 1 4 16V14a1.6 1.6 0 0 1 1.6-1.6ZM18.4 12.4h-2.2v5.2h2.2A1.6 1.6 0 0 0 20 16V14a1.6 1.6 0 0 0-1.6-1.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5.2 6.4h13.6v9.4a1.6 1.6 0 0 1-1.6 1.6H10.2L6 20v-2.6H5.2A1.6 1.6 0 0 1 3.6 15.8V8A1.6 1.6 0 0 1 5.2 6.4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KickGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.4 4.8h4.2v14.4H6.4V4.8Z" fill="currentColor" />
      <path d="M12.2 12 18.4 5.6h-3.4L10.8 12l4.2 6.4h3.4L12.2 12Z" fill="currentColor" />
    </svg>
  );
}

export function profileDisplayName(summary: ProfileSummary): string {
  const joined = [summary.user.telegramFirstName, summary.user.telegramLastName]
    .filter(Boolean)
    .join(" ");
  return summary.user.displayName || joined || "Игрок";
}

export function ProfileView({
  summary,
  balanceAzc,
  streamStreak = 0,
  promo,
  promoNote,
  promoSubmitting = false,
  showAdminPromo = false,
  withdrawOpen = false,
  withdrawUsername = "",
  withdrawNote,
  withdrawSubmitting = false,
  kickBusy = false,
  kickNote,
  onPromoChange,
  onPromoSubmit,
  onSupport,
  onKickConnect,
  onWithdrawOpen,
  onWithdrawClose,
  onWithdrawUsernameChange,
  onWithdrawSubmit,
}: {
  summary: ProfileSummary;
  balanceAzc?: string;
  streamStreak?: number;
  promo: string;
  promoNote?: string;
  promoSubmitting?: boolean;
  showAdminPromo?: boolean;
  withdrawOpen?: boolean;
  withdrawUsername?: string;
  withdrawNote?: string;
  withdrawSubmitting?: boolean;
  kickBusy?: boolean;
  kickNote?: string;
  onPromoChange: (value: string) => void;
  onPromoSubmit: () => void;
  onSupport: () => void;
  onKickConnect?: () => void;
  onWithdrawOpen?: () => void;
  onWithdrawClose?: () => void;
  onWithdrawUsernameChange?: (value: string) => void;
  onWithdrawSubmit?: () => void;
}) {
  const name = profileDisplayName(summary);
  const telegramName = summary.user.telegramUsername
    ? `@${summary.user.telegramUsername.replace(/^@/, "")}`
    : null;
  const xpCurrent = summary.level.currentLevelXp;
  const xpMax = summary.level.nextLevelXp;
  const nextLevel = xpMax ? summary.level.current + 1 : null;
  const gram = summary.gram;
  const unread = summary.notifications.unreadCount;
  const kick = summary.integrations.kick;
  const welvura = summary.integrations.welvura;
  const welvuraCta =
    welvura.status === "pending"
      ? "На проверке"
      : welvura.status === "rejected"
        ? "Отправить заново"
        : welvura.status === "approved"
          ? "Открыть задания"
          : "Привязать";
  const welvuraSub =
    welvura.status === "pending"
      ? "Заявка на проверке"
      : welvura.status === "rejected"
        ? "Заявка отклонена. Можно отправить заново."
        : welvura.status === "approved"
          ? "Аккаунт привязан. Выполняй задания и получай монеты."
          : "Привязывай аккаунт, выполняй задания и получай монеты за депозиты";

  const menu = [
    {
      href: "#/profile/notifications",
      label: "Уведомления",
      tone: "gold",
      icon: <MenuIconBell />,
      badge: unread > 0 ? groupDigits(String(unread)) : null,
    },
    {
      href: "#/profile/history",
      label: "История монет",
      tone: "brown",
      icon: <MenuIconHistory />,
      badge: null,
    },
    {
      href: "#/profile/operations",
      label: "История операций",
      tone: "violet",
      icon: <MenuIconReceipt />,
      badge: null,
    },
    {
      href: "#/profile/inventory",
      label: "Инвентарь",
      tone: "cyan",
      icon: <MenuIconCube />,
      badge: null,
    },
    {
      href: "#/shop/orders",
      label: "Мои заказы",
      tone: "pink",
      icon: <MenuIconBag />,
      badge: null,
    },
    {
      href: "#/profile/achievements",
      label: "Достижения",
      tone: "purple",
      icon: <MenuIconMedal />,
      badge: null,
    },
  ] as const;

  const adminMenu = showAdminPromo
    ? [
        { href: "#/admin/promo-codes", label: "Промокоды" },
        { href: "#/admin/giveaways", label: "Розыгрыши" },
        { href: "#/admin/gram-withdrawals", label: "Gram заявки" },
        { href: "#/admin/shop/orders", label: "Заказы" },
        { href: "#/admin/donations", label: "Донаты" },
        { href: "#/admin/cash-withdrawals", label: "₽ заявки" },
        { href: "#/admin/welvura", label: "Welvura" },
      ]
    : [];

  function openGram(): void {
    if (gram.canWithdraw) {
      onWithdrawOpen?.();
      return;
    }
    navigate("#/profile/gram");
  }

  return (
    <div className="stack profile-page">
      <header className="profile-top">
        <h1>Профиль</h1>
        <BalanceBadge amountAzcString={balanceAzc ?? summary.balances.azc} />
      </header>

      <div className="profile-id">
        <Avatar name={name} src={summary.user.avatarUrl} size={44} />
        <div>
          <p className="profile-id__name">{name}</p>
          {telegramName ? <p className="profile-id__user">{telegramName}</p> : null}
        </div>
      </div>

      <section className="profile-hero">
        <p className="profile-hero__eyebrow">Баланс</p>
        <p className="profile-hero__balance">
          <IconCoin size={34} />
          <span>{groupDigits(summary.balances.azc)}</span>
        </p>
        <div className="profile-hero__rule" />
        <div className="profile-level">
          <p className="profile-level__title">
            {nextLevel ? `Уровень ${String(summary.level.current)} → ${String(nextLevel)}` : `Уровень ${String(summary.level.current)}`}
          </p>
          <p className="profile-level__xp">
            {groupDigits(xpCurrent)}
            {xpMax ? ` / ${groupDigits(xpMax)} XP` : " XP"}
          </p>
        </div>
        <ProgressBar
          value={xpMax ? Number(xpCurrent) || 0 : 1}
          max={xpMax ? Number(xpMax) || 1 : 1}
        />
        <div className="profile-level__meta">
          {summary.level.xpNeededForNext ? (
            <span>До следующего уровня: {groupDigits(summary.level.xpNeededForNext)} XP</span>
          ) : (
            <span>Максимальный уровень</span>
          )}
          <span className="profile-level__reward">
            Награда:{" "}
            {summary.level.nextRewardAzc ? (
              <CoinAmount amount={summary.level.nextRewardAzc} sign="plus" size={14} />
            ) : (
              "—"
            )}
          </span>
        </div>
        <div className="profile-stats">
          <div className="profile-stat">
            <span className="profile-stat__tile profile-stat__tile--pink">
              <IconFlame size={20} />
            </span>
            <p className="profile-stat__value">{String(streamStreak)}</p>
            <p className="profile-stat__label">стримов подряд</p>
          </div>
          <div className="profile-stat">
            <span className="profile-stat__tile profile-stat__tile--green">
              <ChatGlyph />
            </span>
            <p className="profile-stat__value">{groupDigits(summary.activity.kickChatMessages)}</p>
            <p className="profile-stat__label">сообщений в чате</p>
          </div>
        </div>
        <p className="profile-xp-note">
          Опыт начисляется за засчитанные сообщения в чате Kick.
        </p>
      </section>

      <button type="button" className="profile-gram" data-interactive="true" onClick={openGram}>
        <span className="profile-gram__tile">
          <IconGram size={36} />
        </span>
        <span className="profile-gram__copy">
          <span className="profile-gram__title">Gram</span>
          <span className="profile-gram__value">{formatGramAmount(gram.available)}</span>
          <span className="profile-gram__hint">Нажмите, чтобы открыть</span>
          {!gram.canWithdraw ? (
            <span className="profile-gram__min">Минимум для вывода — {gram.minimumWithdrawal} Gram</span>
          ) : null}
        </span>
      </button>
      {withdrawNote && !withdrawOpen ? <p className="muted">{withdrawNote}</p> : null}

      <BottomSheet
        open={withdrawOpen}
        title="Вывод Gram"
        onClose={onWithdrawClose ?? (() => undefined)}
      >
        <div className="stack">
          <p>Доступно: {formatGramAmount(gram.available)}</p>
          <p className="muted">Будет выведен весь доступный баланс</p>
          <label className="field">
            Telegram username
            <input
              value={withdrawUsername}
              placeholder="@username"
              onChange={(event) => onWithdrawUsernameChange?.(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={withdrawSubmitting || !withdrawUsername.trim()}
            onClick={onWithdrawSubmit}
          >
            {withdrawSubmitting ? "Отправка…" : "Подтвердить"}
          </button>
          {withdrawNote ? <p className="muted">{withdrawNote}</p> : null}
        </div>
      </BottomSheet>

      <form
        className="profile-promo"
        onSubmit={(event) => {
          event.preventDefault();
          onPromoSubmit();
        }}
      >
        <p className="profile-promo__title">Промокод</p>
        <div className="profile-promo__row">
          <input
            className="profile-promo__input"
            value={promo}
            placeholder="Слово со стрима"
            onChange={(event) => onPromoChange(event.target.value)}
          />
          <button type="submit" className="profile-promo__go" disabled={promoSubmitting}>
            {promoSubmitting ? "Ввод…" : "Ввести"}
          </button>
        </div>
        {promoNote
          ? promoNote.split("\n").map((line) => (
              <p key={line} className="muted">
                {line}
              </p>
            ))
          : null}
      </form>

      {kick.linked ? (
        <div className="profile-kick is-on">
          <span className="profile-kick__logo profile-kick__logo--avatar">
            <Avatar
              name={kick.displayName || kick.username || "Kick"}
              src={kick.avatarUrl}
              size={40}
            />
          </span>
          <span className="profile-kick__copy">
            <span className="profile-kick__name">
              {kick.displayName || "Kick"}
            </span>
            <span className="profile-kick__user">
              {kick.username
                ? `@${kick.username.replace(/^@/, "")}`
                : "привязан"}
            </span>
          </span>
          <span className="profile-kick__pill">Подключено</span>
        </div>
      ) : (
        <button
          type="button"
          className="profile-kick"
          data-interactive="true"
          disabled={kickBusy}
          onClick={() => onKickConnect?.()}
        >
          <span className="profile-kick__logo">
            <KickGlyph />
          </span>
          <span className="profile-kick__copy">
            <span className="profile-kick__name">Kick</span>
            <span className="profile-kick__user">{kickBusy ? "Подключение…" : "Не привязан"}</span>
          </span>
          <span className="profile-kick__cta">Привязать</span>
        </button>
      )}
      {kickNote ? <p className="muted">{kickNote}</p> : null}

      <button
        type="button"
        className="profile-welvura"
        data-interactive="true"
        onClick={() => navigate("#/tasks/welvura")}
      >
        <span className="profile-welvura__copy">
          <span className="profile-welvura__title">Welvura</span>
          <span className="profile-welvura__sub">{welvuraSub}</span>
          <span className="profile-welvura__cta">
            {welvuraCta} <span aria-hidden="true">›</span>
          </span>
        </span>
        <span className="profile-welvura__art" aria-hidden="true">
          <CookieArt />
        </span>
      </button>

      <div className="profile-menu">
        {menu.map((item) => (
          <button
            key={item.href}
            type="button"
            className="profile-menu__row"
            data-interactive="true"
            onClick={() => navigate(item.href)}
          >
            <span className={`profile-menu__tile profile-menu__tile--${item.tone}`}>{item.icon}</span>
            <span className="profile-menu__label">{item.label}</span>
            {item.badge ? <span className="profile-menu__badge">{item.badge}</span> : null}
            <span className="profile-menu__chev" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
        <button type="button" className="profile-menu__row" data-interactive="true" onClick={onSupport}>
          <span className="profile-menu__tile profile-menu__tile--teal">
            <MenuIconHeadset />
          </span>
          <span className="profile-menu__label">Тех. поддержка</span>
          <span className="profile-menu__chev" aria-hidden="true">
            ›
          </span>
        </button>
      </div>

      {adminMenu.length > 0 ? (
        <div className="profile-menu">
          {adminMenu.map((item) => (
            <button
              key={item.href}
              type="button"
              className="profile-menu__row"
              data-interactive="true"
              onClick={() => navigate(item.href)}
            >
              <span className="profile-menu__label">{item.label}</span>
              <span className="profile-menu__chev" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
