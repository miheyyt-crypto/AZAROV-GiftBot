import { CoinAmount } from "../components/CoinAmount.js";
import { GiveawayCheckIcon, GiveawayTrophyIcon } from "./giveaway-icons.js";
import { GiveawayEmpty } from "./GiveawayEmpty.js";
import {
  eligibilityLabel,
  formatCountdown,
  isViewerWinner,
  prizeLabel,
  remainingFromEndsAt,
  winnerPrizeLabel,
} from "./messages.js";
import type { GiveawayPublic, GiveawayTab } from "./types.js";

export function GiveawaysView({
  tab,
  items,
  serverTime,
  fetchedAtMs,
  nowMs,
  viewerPublicId,
  busyId,
  note,
  compact = false,
  onJoin,
  onLinkKick,
  onCardClick,
  onShowCompleted,
}: {
  tab: GiveawayTab;
  items: GiveawayPublic[];
  serverTime: string;
  fetchedAtMs: number;
  nowMs: number;
  viewerPublicId?: string;
  busyId?: string | null;
  note?: string;
  compact?: boolean;
  onJoin?: (id: string) => void;
  onLinkKick?: () => void;
  onCardClick?: (id: string) => void;
  onShowCompleted?: () => void;
}) {
  if (items.length === 0) {
    return (
      <>
        <GiveawayEmpty
          kind={tab === "active" ? "active" : "completed"}
          action={
            tab === "active" && onShowCompleted ? (
              <button
                type="button"
                className="giveaway-empty__action"
                onClick={onShowCompleted}
              >
                Посмотреть историю
              </button>
            ) : undefined
          }
        />
        {note ? <p className="muted">{note}</p> : null}
      </>
    );
  }

  return (
    <div className="stack giveaway-list">
      {note ? <p className="muted">{note}</p> : null}
      {items.map((row) => {
        const remaining = remainingFromEndsAt(
          row.endsAt,
          serverTime || row.serverTime,
          fetchedAtMs,
          nowMs,
        );
        const won = isViewerWinner(row, viewerPublicId);
        const clickable = Boolean(onCardClick);
        return (
          <article
            key={row.id}
            className={`giveaway-card${tab === "completed" ? " is-done" : " is-live"}${
              clickable ? " card--btn" : ""
            }${row.imageUrl ? " giveaway-card--photo" : ""}`}
            data-testid="giveaway-card"
            data-status={row.status}
            {...(won ? { "data-won": "true" } : {})}
            onClick={
              clickable
                ? () => {
                    onCardClick?.(row.id);
                  }
                : undefined
            }
          >
            {row.imageUrl ? (
              <div
                className={`giveaway-card__media${compact ? " giveaway-card__media--home" : ""}`}
              >
                <img
                  src={row.imageUrl}
                  alt=""
                  decoding="async"
                  loading={compact ? "eager" : "lazy"}
                />
              </div>
            ) : null}
            <p className="giveaway-card__title">{row.title}</p>
            <p className="giveaway-card__prize">
              {row.type === "coins" && row.bankAzc ? (
                <CoinAmount amount={row.bankAzc} />
              ) : (
                prizeLabel(row)
              )}
            </p>
            <p className="giveaway-card__meta">
              Победителей: {row.actualWinnerCount ?? row.winnerCount}
            </p>
            <p className="giveaway-card__meta">{eligibilityLabel(row.eligibility)}</p>
            <p className="giveaway-card__meta">Участников: {row.participantCount}</p>

            {tab === "active" ? (
              <>
                {row.status === "drawing" ? (
                  <p className="giveaway-card__meta">Идёт подведение итогов</p>
                ) : row.endsAt ? (
                  <p className="giveaway-card__meta" data-testid="giveaway-countdown">
                    Осталось {formatCountdown(remaining)}
                  </p>
                ) : null}
                {!compact ? (
                  <GiveawayJoinCta
                    row={row}
                    busy={busyId === row.id}
                    {...(onJoin ? { onJoin } : {})}
                    {...(onLinkKick ? { onLinkKick } : {})}
                  />
                ) : null}
              </>
            ) : (
              <WinnersBlock
                row={row}
                {...(viewerPublicId ? { viewerPublicId } : {})}
                won={won}
              />
            )}
          </article>
        );
      })}
    </div>
  );
}

function GiveawayJoinCta({
  row,
  busy,
  onJoin,
  onLinkKick,
}: {
  row: GiveawayPublic;
  busy: boolean;
  onJoin?: (id: string) => void;
  onLinkKick?: () => void;
}) {
  if (row.status !== "active") {
    return null;
  }
  if (row.joined) {
    return (
      <p className="giveaway-joined">
        <GiveawayCheckIcon size={15} />
        Вы участвуете
      </p>
    );
  }
  if (!row.eligible) {
    return (
      <button
        type="button"
        className="giveaway-cta giveaway-cta--ghost"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onLinkKick?.();
        }}
      >
        Привязать Kick
      </button>
    );
  }
  return (
    <button
      type="button"
      className="giveaway-cta"
      disabled={busy || !onJoin}
      onClick={(event) => {
        event.stopPropagation();
        onJoin?.(row.id);
      }}
    >
      Участвовать
    </button>
  );
}

function WinnersBlock({
  row,
  viewerPublicId,
  won,
}: {
  row: GiveawayPublic;
  viewerPublicId?: string;
  won: boolean;
}) {
  const winners = row.winners ?? [];
  if (winners.length === 0) {
    return <p className="giveaway-card__meta">Победители не объявлены</p>;
  }
  return (
    <div className="giveaway-winners-block">
      {won ? <p className="giveaway-won">Вы победили!</p> : null}
      <p className="giveaway-winners-block__label">
        <GiveawayTrophyIcon size={14} />
        Победители
      </p>
      <ul className="giveaway-winners">
        {winners.map((winner) => {
          const isYou =
            viewerPublicId != null && winner.publicId === viewerPublicId;
          return (
            <li
              key={`${winner.userId}-${winner.publicId}`}
              className={isYou ? "is-you" : undefined}
              data-testid={isYou ? "giveaway-winner-you" : "giveaway-winner"}
            >
              <span>{winner.publicId}</span>
              <span>
                {winner.prizeAzc ? (
                  <CoinAmount amount={winner.prizeAzc} size={13} />
                ) : (
                  winnerPrizeLabel(winner)
                )}
              </span>
              {isYou ? <span> · вы</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
