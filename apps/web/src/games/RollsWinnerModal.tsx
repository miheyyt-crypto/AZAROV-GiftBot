import { Avatar } from "../components/Avatar.js";
import { httpsAvatarSrc } from "../lib/https-url.js";
import { CloseButton } from "../components/CloseButton.js";
import { OverlayPortal } from "../components/OverlayPortal.js";
import { CoinAmount } from "../components/CoinAmount.js";
import { RollsCoinIcon } from "./rolls-icons.js";
import {
  formatPlayerName,
  formatRollsGameTitle,
  winMultiplier,
  winnerChancePercent,
} from "./rolls-ui.js";
import type { RollsParticipant, RollsRound } from "./rolls-types.js";

function avatarSrc(key: string | null | undefined): string | undefined {
  return httpsAvatarSrc(key);
}

export function RollsWinnerModal({
  round,
  winner,
  onClose,
}: {
  round: RollsRound;
  winner: RollsParticipant;
  onClose: () => void;
}) {
  const payout = round.payoutAzc ?? "0";
  const chance = winnerChancePercent(winner.stakeAzc, round.totalPotAzc);
  const multiplier = winMultiplier(payout, winner.stakeAzc);
  const photo = avatarSrc(winner.avatarUrl ?? winner.avatarKey);

  return (
    <OverlayPortal>
    <div className="gift-overlay" role="presentation">
      <button
        type="button"
        className="gift-overlay__backdrop"
        aria-label="Закрыть"
        onClick={onClose}
      />
      <div
        className="gift-overlay__card rolls-win-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rolls-win-title"
        data-testid="rolls-win-modal"
      >
        <header className="rolls-win-modal__head">
          <h2 id="rolls-win-title" className="rolls-win-modal__title">
            {formatRollsGameTitle(round.nonce)}
          </h2>
          <CloseButton onClick={onClose} size="sheet" />
        </header>
        <div className="rolls-win-modal__hero">
          <Avatar
            name={winner.displayName}
            {...(photo ? { src: photo } : {})}
            size={42}
          />
          <div className="rolls-win-modal__who">
            <p className="rolls-win-modal__name">
              {formatPlayerName(winner.displayName)}
            </p>
            <p className="rolls-win-modal__chance">{chance}%</p>
          </div>
          <div className="rolls-win-modal__payout">
            <CoinAmount
              amount={payout}
              sign="plus"
              size={18}
              className="rolls-win-modal__plus"
              icon={<RollsCoinIcon size={16} />}
            />
            <p className="rolls-win-modal__mult">x{multiplier}</p>
          </div>
        </div>
        <div className="rolls-win-modal__prize">
          <div className="rolls-win-modal__prize-art" aria-hidden="true">
            <span className="rolls-win-modal__prize-orb">
              <RollsCoinIcon size={28} />
            </span>
            <span>Монеты</span>
          </div>
          <p className="rolls-win-modal__prize-sum">
            <CoinAmount
              amount={payout}
              size={15}
              icon={<RollsCoinIcon size={15} />}
            />
          </p>
        </div>
        <button type="button" className="rolls-win-modal__done" onClick={onClose}>
          Готово
        </button>
      </div>
    </div>
    </OverlayPortal>
  );
}
