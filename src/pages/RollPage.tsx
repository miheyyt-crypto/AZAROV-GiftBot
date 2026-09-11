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

/** Mobile Roll presentation — game logic lives in useRollGame. */
export function RollPage() {
  const navigate = useNavigate()
  const game = useRollGame()

  if (!game.bootstrapped) {
    return (
      <div className="ui-page">
        <div className="h-10 w-40 animate-pulse rounded-xl bg-white/[0.06]" />
        <div className="mt-4 aspect-square animate-pulse rounded-full bg-white/[0.04]" />
      </div>
    )
  }

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
    <div
      className="roll-page ui-page relative pb-8"
      data-roll-phase={round?.status || 'waiting'}
    >
      <RollLavaBackground phase={round?.status || 'waiting'} />

      {winnerCardRound ? (
        <RollWinnerCard
          round={winnerCardRound}
          open={winnerCardOpen}
          onClose={closeWinnerCard}
        />
      ) : null}

      <RollConfetti active={showConfetti && winnerCardOpen} burstKey={confettiKey} />

      <header className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(ROUTES.home)}
          className="roll-glass flex size-10 shrink-0 items-center justify-center rounded-[12px] text-white/85 transition active:scale-95"
          aria-label="В главное меню"
        >
          <ArrowLeft size={18} aria-hidden />
        </button>
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-xl font-bold text-white drop-shadow-[0_2px_12px_rgb(0_0_0/45%)]">
          <span aria-hidden>🍥</span>
          <span>Roll</span>
        </h1>
        <div
          className="roll-balance-pill inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-semibold text-white"
          aria-label={`Баланс ${formatted}`}
        >
          <CoinIcon className="size-4" />
          <span className="tabular-nums">{formatted}</span>
        </div>
      </header>

      <RollStatsCards previousGame={previousGame} topGame={topGame} />

      {(round?.status === 'waiting' ||
        round?.status === 'betting' ||
        round?.status === 'spinning' ||
        round?.status === 'locked' ||
        round?.status === 'completed') &&
        potPill(round)}

      <RollWheel
        round={displayRound}
        countdownMs={countdownMs}
        spinClock={spinClock}
      />

      {bettingOpen ? (
        <section className="roll-glass mb-3 rounded-[20px] p-4">
          {addMode ? (
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab]">
                Добавить к ставке
              </p>
              <p className="inline-flex items-center gap-1 text-[13px] font-bold text-white">
                Твоя ставка:
                <span className="tabular-nums text-[#7dd3fc]">{formatBalance(myStake)}</span>
                <CoinIcon className="size-3.5" />
              </p>
            </div>
          ) : (
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab]">
              Сумма ставки
            </p>
          )}

          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateBet(Math.max(amountFloor, Math.floor(bet / 2)))}
              className="flex size-11 items-center justify-center rounded-[12px] border border-white/10 bg-[#1a1524] text-sm font-bold text-white active:scale-95"
            >
              ½
            </button>
            <button
              type="button"
              onClick={() => updateBet(bet * 2)}
              className="flex size-11 items-center justify-center rounded-[12px] border border-white/10 bg-[#1a1524] text-sm font-bold text-white active:scale-95"
            >
              2×
            </button>
            <label className="flex min-h-11 min-w-0 flex-1 items-center justify-between rounded-full border border-[rgb(139_61_255/35%)] bg-[#0c0914] px-4">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                value={betInput}
                onChange={(e) => onBetInputChange(e.target.value)}
                onBlur={() => syncBetValue(bet)}
                placeholder="Введите сумму"
                aria-label={addMode ? 'Сумма пополнения' : 'Сумма ставки'}
                className="min-w-0 flex-1 bg-transparent text-lg font-bold tabular-nums text-white outline-none placeholder:text-white/30"
              />
              <CoinIcon className="size-5 shrink-0" />
            </label>
            <button
              type="button"
              onClick={() => updateBet(amount)}
              className="min-h-11 rounded-[12px] border border-white/10 bg-[#1a1524] px-3 text-xs font-bold text-white active:scale-95"
            >
              МАКС
            </button>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
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
                    'min-h-9 rounded-full border px-3 text-xs font-semibold transition',
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
            className="flex w-full items-center justify-center gap-2 rounded-[16px] bg-[linear-gradient(180deg,#ffb020,#f59e0b)] px-4 py-3.5 text-[15px] font-bold text-[#1a1000] shadow-[0_8px_24px_rgb(245_158_11/35%)] transition active:scale-[0.98] disabled:opacity-45"
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
            <p className="mt-2 text-xs text-amber-300/90">
              {addMode
                ? 'Недостаточно монет для пополнения.'
                : `Нужно минимум ${minBet} монет.`}
            </p>
          ) : null}
        </section>
      ) : null}

      {viewerInRound && round?.status === 'waiting' ? (
        <p className="roll-glass mb-3 rounded-[14px] px-3 py-2.5 text-center text-[13px] text-white/65">
          Можно увеличить ставку, пока ждём второго игрока.
        </p>
      ) : null}

      {viewerInRound && round?.status === 'betting' ? (
        <p className="roll-glass mb-3 rounded-[14px] px-3 py-2.5 text-center text-[13px] text-white/65">
          Можно увеличить ставку до конца отсчёта.
        </p>
      ) : null}

      {viewerInRound && !bettingOpen ? (
        <p className="roll-glass mb-3 rounded-[14px] px-3 py-2.5 text-center text-[13px] text-white/65">
          Ставки закрыты
        </p>
      ) : null}

      <RollPlayerList round={round} />
    </div>
  )
}

function potPill(round: RollRound | null) {
  const pot = Number(round?.pot) || 0
  return (
    <div className="mb-2 flex justify-center">
      <div className="roll-pot-pill">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
          Всего
        </span>
        <span className="text-[13px] font-bold tabular-nums text-[#7dd3fc]">
          {formatBalance(pot)}
        </span>
        <CoinIcon className="size-3.5" />
      </div>
    </div>
  )
}
