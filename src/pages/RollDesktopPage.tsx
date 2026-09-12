import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { CoinIcon } from '@/components/CoinIcon'
import { RollConfetti } from '@/components/roll/RollConfetti'
import { RollLavaBackground } from '@/components/roll/RollLavaBackground'
import { RollPlayerList } from '@/components/roll/RollPlayerList'
import { RollStatsCards } from '@/components/roll/RollStatsCards'
import { RollWheel } from '@/components/roll/RollWheel'
import { RollWinnerCard } from '@/components/roll/RollWinnerCard'
import { useRollGame } from '@/hooks/useRollGame'
import { ROUTES } from '@/lib/constants'
import { formatBalance } from '@/lib/balance'
import type { RollRound } from '@/types/roll'

/**
 * Isolated Desktop Roll shell — same useRollGame as mobile.
 * One inner scroller (.roll-desktop__scroll); no ui-page / vh chrome math.
 */
export function RollDesktopPage() {
  const navigate = useNavigate()
  const game = useRollGame()
  // Shell paints immediately; bets stay gated until bootstrapped (see useRollGame).

  const {
    round,
    formatted,
    previousGame,
    topGame,
    displayRound,
    countdownMs,
    spinClock,
    winnerCardRound,
    winnerCardOpen,
    closeWinnerCard,
    showConfetti,
    confettiKey,
    bettingOpen,
    addMode,
    myStake,
    amountFloor,
    minBet,
    bet,
    betInput,
    quickBets,
    amount,
    canSubmit,
    busy,
    account,
    viewerInRound,
    updateBet,
    onBetInputChange,
    syncBetValue,
    handleBet,
  } = game

  return (
    <div className="roll-desktop" data-roll-phase={round?.status || 'waiting'}>
      <RollLavaBackground phase={round?.status || 'waiting'} />

      {winnerCardRound ? (
        <RollWinnerCard
          round={winnerCardRound}
          open={winnerCardOpen}
          onClose={closeWinnerCard}
        />
      ) : null}

      <RollConfetti active={showConfetti && winnerCardOpen} burstKey={confettiKey} />

      <header className="roll-desktop__chrome">
        <button
          type="button"
          onClick={() => navigate(ROUTES.home)}
          className="roll-glass flex size-9 shrink-0 items-center justify-center rounded-[10px] text-white/85 transition active:scale-95"
          aria-label="В главное меню"
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
        <h1 className="flex min-w-0 flex-1 items-center gap-1.5 text-lg font-bold text-white">
          <span aria-hidden>🍥</span>
          <span>Roll</span>
        </h1>
        <div
          className="roll-balance-pill inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-white"
          aria-label={`Баланс ${formatted}`}
        >
          <CoinIcon className="size-3.5" />
          <span className="tabular-nums">{formatted}</span>
        </div>
      </header>

      <div className="roll-desktop__scroll">
        <div className="mb-2">
          <RollStatsCards previousGame={previousGame} topGame={topGame} />
        </div>

        {(round?.status === 'waiting' ||
          round?.status === 'betting' ||
          round?.status === 'spinning' ||
          round?.status === 'locked' ||
          round?.status === 'completed') &&
          desktopPotPill(round)}

        <RollWheel
          round={displayRound}
          countdownMs={countdownMs}
          spinClock={spinClock}
          stageClassName="roll-wheel-stage relative mx-auto mb-1.5 w-full max-w-[min(70vw,280px)]"
        />

        {bettingOpen ? (
          <section className="roll-glass mb-2 rounded-[16px] p-3">
            {addMode ? (
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b96ab]">
                  Добавить к ставке
                </p>
                <p className="inline-flex items-center gap-1 text-[12px] font-bold text-white">
                  Твоя ставка:
                  <span className="tabular-nums text-[#7dd3fc]">{formatBalance(myStake)}</span>
                  <CoinIcon className="size-3" />
                </p>
              </div>
            ) : (
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#9b96ab]">
                Сумма ставки
              </p>
            )}

            <div className="mb-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => updateBet(Math.max(amountFloor, Math.floor(bet / 2)))}
                className="flex size-9 items-center justify-center rounded-[10px] border border-white/10 bg-[#1a1524] text-xs font-bold text-white active:scale-95"
              >
                ½
              </button>
              <button
                type="button"
                onClick={() => updateBet(bet * 2)}
                className="flex size-9 items-center justify-center rounded-[10px] border border-white/10 bg-[#1a1524] text-xs font-bold text-white active:scale-95"
              >
                2×
              </button>
              <label className="flex min-h-9 min-w-0 flex-1 items-center justify-between rounded-full border border-[rgb(139_61_255/35%)] bg-[#0c0914] px-3">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  enterKeyHint="done"
                  value={betInput}
                  onChange={(e) => onBetInputChange(e.target.value)}
                  onBlur={() => syncBetValue(bet)}
                  placeholder="Сумма"
                  aria-label={addMode ? 'Сумма пополнения' : 'Сумма ставки'}
                  className="min-w-0 flex-1 bg-transparent text-base font-bold tabular-nums text-white outline-none placeholder:text-white/30"
                />
                <CoinIcon className="size-4 shrink-0" />
              </label>
              <button
                type="button"
                onClick={() => updateBet(amount)}
                className="min-h-9 rounded-[10px] border border-white/10 bg-[#1a1524] px-2.5 text-[11px] font-bold text-white active:scale-95"
              >
                МАКС
              </button>
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
              {quickBets.map((value) => {
                const disabled = value > amount
                const active = bet === value
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    onClick={() => updateBet(value)}
                    className={[
                      'min-h-8 rounded-full border px-2.5 text-[11px] font-semibold transition',
                      active
                        ? 'border-[rgb(255_106_43/70%)] bg-[rgb(255_106_43/20%)] text-white'
                        : 'border-white/10 bg-[#1a1524] text-[#cfc8df]',
                      disabled ? 'opacity-40' : 'active:scale-95',
                    ].join(' ')}
                  >
                    {addMode ? `+${value.toLocaleString('ru-RU')}` : value.toLocaleString('ru-RU')}
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleBet()}
              className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-[linear-gradient(180deg,#ffb020,#f59e0b)] px-4 py-3 text-[14px] font-bold text-[#1a1000] shadow-[0_8px_24px_rgb(245_158_11/35%)] transition active:scale-[0.98] disabled:opacity-45"
            >
              {busy
                ? addMode
                  ? 'Добавляем…'
                  : 'Отправка…'
                : addMode
                  ? 'Добавить'
                  : 'Поставить'}
            </button>
            {account.telegramId > 0 && amount < amountFloor ? (
              <p className="mt-1.5 text-[11px] text-amber-300/90">
                {addMode
                  ? 'Недостаточно монет для пополнения.'
                  : `Нужно минимум ${minBet} монет.`}
              </p>
            ) : null}
          </section>
        ) : null}

        {viewerInRound && round?.status === 'waiting' ? (
          <p className="roll-glass mb-2 rounded-[12px] px-3 py-2 text-center text-[12px] text-white/65">
            Можно увеличить ставку, пока ждём второго игрока.
          </p>
        ) : null}

        {viewerInRound && round?.status === 'betting' ? (
          <p className="roll-glass mb-2 rounded-[12px] px-3 py-2 text-center text-[12px] text-white/65">
            Можно увеличить ставку до конца отсчёта.
          </p>
        ) : null}

        {viewerInRound && !bettingOpen ? (
          <p className="roll-glass mb-2 rounded-[12px] px-3 py-2 text-center text-[12px] text-white/65">
            Ставки закрыты
          </p>
        ) : null}

        <RollPlayerList round={round} maxVisibleRows={5} />
      </div>
    </div>
  )
}

function desktopPotPill(round: RollRound | null) {
  const pot = Number(round?.pot) || 0
  return (
    <div className="mb-1.5 flex justify-center">
      <div className="roll-pot-pill">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/45">
          Всего
        </span>
        <span className="text-[12px] font-bold tabular-nums text-[#7dd3fc]">
          {formatBalance(pot)}
        </span>
        <CoinIcon className="size-3" />
      </div>
    </div>
  )
}
