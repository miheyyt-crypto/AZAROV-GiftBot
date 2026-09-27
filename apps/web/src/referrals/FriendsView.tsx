import { CASE_ART_SRC } from "../assets/cases.js";
import { Avatar } from "../components/Avatar.js";
import {
  IconBolt,
  IconChevron,
  IconCoin,
  IconCopy,
  IconFriends,
  IconGiftOutline,
  IconInvite,
  IconLink,
  IconTelegram,
} from "../assets/icons.js";
import { BalanceBadge } from "../components/BalanceBadge.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { ProgressBar } from "../components/ProgressBar.js";
import { groupDigits } from "../lib/format.js";
import {
  REFERRAL_ACTIVATION_REWARD_DISPLAY,
  REFERRAL_CASE_MAX_CASH_RUB,
} from "./friends-ui.js";
import { REFERRAL_STEPS, type ReferralListResponse, type ReferralMeSummary } from "./types.js";

export function FriendsView({
  me,
  list,
  balanceAzc,
  copied,
  onCopy,
  onShare,
  onOpenCase,
}: {
  me: ReferralMeSummary;
  list: ReferralListResponse;
  balanceAzc: string;
  copied: boolean;
  onCopy: () => void;
  onShare: () => void;
  onOpenCase: () => void;
}) {
  const progressCurrent = me.caseProgress.current;
  const progressTarget = me.caseProgress.target;
  const canShare = me.referralUrl.length > 0;

  return (
    <div className="stack friends-page">
      <header className="friends-head">
        <h1>Рефералы</h1>
        <BalanceBadge amountAzcString={balanceAzc} />
      </header>

      <button
        type="button"
        className="friends-hero"
        onClick={onOpenCase}
        data-testid="referral-case-card"
      >
        <span className="friends-hero__art">
          <img src={CASE_ART_SRC.referral} alt="" width={64} height={64} />
        </span>
        <span className="friends-hero__copy">
          <span className="friends-hero__title">Реферальный кейс</span>
          <span className="friends-hero__sub">
            Внутри — до {groupDigits(REFERRAL_CASE_MAX_CASH_RUB)} ₽
          </span>
        </span>
        <span className="friends-hero__chev" aria-hidden="true">
          <IconChevron size={16} />
        </span>
      </button>

      <section className="friends-stats">
        <div className="friends-stats__grid">
          <div className="friends-stat">
            <p className="friends-stat__value">{me.stats.invited}</p>
            <p className="friends-stat__label">Приглашено</p>
          </div>
          <div className="friends-stat">
            <p className="friends-stat__value">{me.stats.active}</p>
            <p className="friends-stat__label">Активны</p>
          </div>
          <div className="friends-stat">
            <p className="friends-stat__value">
              <CoinAmount amount={me.stats.earnedAzc} size={16} />
            </p>
            <p className="friends-stat__label">Заработано</p>
          </div>
        </div>

        <div className="friends-yours">
          <span className="friends-tile friends-tile--purple">
            <IconFriends size={18} />
          </span>
          <div>
            <p className="friends-yours__title">Ваши рефералы</p>
            <p className="friends-yours__sub">Активные: {me.stats.active}</p>
          </div>
        </div>

        <div className="friends-progress">
          <div className="friends-progress__row">
            <span>До реферального кейса</span>
            <span>
              {progressCurrent} / {progressTarget}
            </span>
          </div>
          <ProgressBar value={progressCurrent} max={progressTarget} />
        </div>

        {list.items.length > 0 ? (
          <ul className="friends-list">
            {list.items.map((row) => (
              <li key={row.id}>
                <span className="friends-list__who">
                  <Avatar
                    name={row.username ?? row.publicId ?? "друг"}
                    src={row.avatarUrl}
                    size={28}
                  />
                  <span>{row.username ?? row.publicId ?? "друг"}</span>
                </span>
                <span>{row.statusLabel}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="friends-link-card">
        <div className="friends-link-card__head">
          <span className="friends-tile friends-tile--link">
            <IconLink size={18} />
          </span>
          <h2>Реферальная ссылка</h2>
        </div>

        <div className="friends-benefits">
          <div className="friends-benefit friends-benefit--green">
            <span className="friends-benefit__icon friends-benefit__icon--coin">
              <IconCoin size={22} />
            </span>
            <p className="friends-benefit__kicker">За приглашение</p>
            <p className="friends-benefit__prize">
              <CoinAmount amount={REFERRAL_ACTIVATION_REWARD_DISPLAY} size={18} />
            </p>
            <p className="friends-benefit__hint">после привязки Kick</p>
          </div>
          <div className="friends-benefit friends-benefit--violet">
            <span className="friends-benefit__icon friends-benefit__icon--gift">
              <IconGiftOutline size={22} />
            </span>
            <p className="friends-benefit__kicker">За активного друга</p>
            <p className="friends-benefit__prize">реф-кейс</p>
            <p className="friends-benefit__hint">каждые 5 друзей</p>
          </div>
        </div>

        <div className="friends-url">
          <span className="friends-url__icon" aria-hidden="true">
            <IconLink size={16} />
          </span>
          <p className="friends-url__text" title={me.referralUrl}>
            {me.referralUrl || "—"}
          </p>
          <button
            type="button"
            className="friends-copy"
            onClick={onCopy}
            disabled={!canShare}
            data-testid="referral-copy"
            aria-label="Скопировать ссылку"
          >
            <IconCopy size={16} />
          </button>
        </div>
        {copied ? (
          <p className="friends-copied" aria-live="polite">
            Ссылка скопирована
          </p>
        ) : null}

        <button
          type="button"
          className="friends-share"
          onClick={onShare}
          disabled={!canShare}
          data-testid="referral-share"
        >
          <IconTelegram size={18} />
          Пригласить друга в Telegram
        </button>

        <p className="friends-note">
          <strong>Важно:</strong> награда начисляется только после успешной
          привязки Kick приглашённым другом.
        </p>
      </section>

      <section className="friends-how">
        <div className="friends-how__head">
          <span className="friends-tile friends-tile--bolt">
            <IconBolt size={18} />
          </span>
          <div>
            <h2>Как это работает</h2>
            <p>4 шага до твоего реф-кейса</p>
          </div>
        </div>

        <div className="friends-steps">
          <article className="friends-step friends-step--green">
            <span className="friends-step__n">1</span>
            <span className="friends-step__icon">
              <IconInvite size={20} />
            </span>
            <h3>{REFERRAL_STEPS[0]}</h3>
            <p>
              Поделись своей ссылкой
              <br />
              через Telegram
            </p>
          </article>
          <article className="friends-step friends-step--blue">
            <span className="friends-step__n">2</span>
            <span className="friends-step__icon">
              <IconLink size={20} />
            </span>
            <h3>{REFERRAL_STEPS[1]}</h3>
            <p>
              Вы оба получаете по
              <br />
              <CoinAmount amount={REFERRAL_ACTIVATION_REWARD_DISPLAY} size={14} />
            </p>
          </article>
          <article className="friends-step friends-step--violet">
            <span className="friends-step__n">3</span>
            <span className="friends-step__icon">
              <IconFriends size={20} />
            </span>
            <h3>{REFERRAL_STEPS[2]}</h3>
            <p>
              Каждые 5
              <br />
              подтверждённых друзей
              <br />— прогресс к кейсу
            </p>
          </article>
          <article className="friends-step friends-step--gold">
            <span className="friends-step__n">4</span>
            <span className="friends-step__icon">
              <IconGiftOutline size={20} />
            </span>
            <h3>{REFERRAL_STEPS[3]}</h3>
            <p>
              Открывай реферальный
              <br />
              кейс и забирай награды
            </p>
          </article>
        </div>

        <p className="friends-rules">
          Один Telegram-аккаунт — один реферер, навсегда. Свою ссылку открыть
          нельзя. Награда начисляется только после успешной привязки Kick
          приглашённым другом.
        </p>
      </section>
    </div>
  );
}
