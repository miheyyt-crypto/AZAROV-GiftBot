import { ArrowLeft, Bomb, Gem, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CoinIcon } from '@/components/CoinIcon'
import { useNotifications } from '@/components/NotificationProvider'
import { useBalance } from '@/hooks/useBalance'
import { ROUTES } from '@/lib/constants'
import {
  cashoutMinesGame,
  fetchActiveMinesGame,
  revealMinesCell,
  startMinesGame,
} from '@/lib/mines'
import {
  MINES_ALLOWED_COUNTS,
  MINES_GRID_SIZE,
  MINES_MIN_BET,
  MINES_QUICK_BETS,
  type MinesGame,
} from '@/types/mines'

function clampBet(value: number, balance: number): number {
  const maxAffordable = Math.max(0, Math.floor(balance))
  if (maxAffordable < MINES_MIN_BET) {
    return MINES_MIN_BET
  }
  return Math.min(Math.max(MINES_MIN_BET, Math.floor(value)), maxAffordable)
}

export function MinesPage() {
  const navigate = useNavigate()
  const { amount, formatted } = useBalance()
  const { showNotification } = useNotifications()

  const [bet, setBet] = useState(MINES_MIN_BET)
  const [mineCount, setMineCount] = useState(5)
  const [game, setGame] = useState<MinesGame | null>(null)
  const [busy, setBusy] = useState(false)
  const [revealingCell, setRevealingCell] = useState<number | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)

  const playing = game?.status === 'playing'
  const finished = game?.status === 'won' || game?.status === 'lost'

  useEffect(() => {
    let cancelled = false
    void fetchActiveMinesGame().then((result) => {
      if (cancelled) {
        return
      }
      if (result.success && result.game?.status === 'playing') {
        setGame(result.game)
      }
      setBootstrapped(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!playing) {
      setBet((current) => clampBet(current, amount))
    }
  }, [amount, playing])

  const canStart =
    !playing &&
    !busy &&
    amount >= MINES_MIN_BET &&
    bet >= MINES_MIN_BET &&
    bet <= amount &&
    MINES_ALLOWED_COUNTS.includes(mineCount as (typeof MINES_ALLOWED_COUNTS)[number])

  const mineSet = useMemo(() => new Set(game?.mineIndices || []), [game?.mineIndices])
  const revealedSet = useMemo(() => new Set(game?.revealed || []), [game?.revealed])

  const updateBet = useCallback(
    (next: number) => {
      if (playing) {
        return
      }
      setBet(clampBet(next, amount))
    },
    [amount, playing],
  )

  async function handleStart() {
    if (!canStart) {
      if (amount < MINES_MIN_BET) {
        showNotification({
          type: 'warning',
          title: 'Недостаточно монет',
          message: `Минимальная ставка — ${MINES_MIN_BET} монет.`,
        })
      }
      return
    }
    setBusy(true)
    try {
      const result = await startMinesGame({ bet, mineCount })
      if (!result.success || !result.game) {
        showNotification({
          type: 'error',
          title: 'Не удалось начать',
          message: result.message || 'Попробуй ещё раз.',
        })
        return
      }
      setGame(result.game)
    } finally {
      setBusy(false)
    }
  }

  async function handleReveal(cellIndex: number) {
    if (!game || game.status !== 'playing' || busy || revealedSet.has(cellIndex)) {
      return
    }
    setBusy(true)
    setRevealingCell(cellIndex)
    try {
      const result = await revealMinesCell({ gameId: game.id, cellIndex })
      if (!result.success || !result.game) {
        showNotification({
          type: 'error',
          title: 'Ошибка',
          message: result.message || 'Не удалось открыть клетку.',
        })
        return
      }
      setGame(result.game)
      if (result.hitMine || result.game.status === 'lost') {
        showNotification({
          type: 'error',
          title: 'Мина!',
          message: `Ставка ${result.game.bet} монет проиграна.`,
        })
      } else if (result.game.status === 'won') {
        showNotification({
          type: 'success',
          title: 'Победа!',
          message: `+${result.game.payout?.toLocaleString('ru-RU')} монет`,
        })
      }
    } finally {
      setRevealingCell(null)
      setBusy(false)
    }
  }

  async function handleCashout() {
    if (!game || game.status !== 'playing' || !game.canCashout || busy) {
      return
    }
    setBusy(true)
    try {
      const result = await cashoutMinesGame({ gameId: game.id })
      if (!result.success || !result.game) {
        showNotification({
          type: 'error',
          title: 'Не удалось забрать',
          message: result.message || 'Попробуй ещё раз.',
        })
        return
      }
      setGame(result.game)
      showNotification({
        type: 'success',
        title: 'Выигрыш забран',
        message: `+${(result.game.payout || 0).toLocaleString('ru-RU')} монет`,
      })
    } finally {
      setBusy(false)
    }
  }

  function handleNewRound() {
    setGame(null)
    setBet((current) => clampBet(current, amount))
  }

  if (!bootstrapped) {
    return (
      <div className="ui-page">
        <div className="h-10 w-40 animate-pulse rounded-xl bg-white/[0.06]" />
        <div className="mt-4 aspect-square animate-pulse rounded-[24px] bg-white/[0.04]" />
      </div>
    )
  }

  return (
    <div className="mines-page ui-page pb-8">
      <header className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-[#16121f] text-white/80 transition active:scale-95"
          aria-label="Назад"
        >
          <ArrowLeft size={18} aria-hidden />
        </button>
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-xl font-bold text-white">
          <span aria-hidden>💣</span>
          <span>Mines</span>
        </h1>
        <button
          type="button"
          onClick={() => navigate(ROUTES.tasks)}
          className="inline-flex items-center gap-1.5 rounded-full border border-gold/35 bg-black/40 px-2.5 py-1.5 text-sm font-semibold text-white"
          aria-label={`Баланс ${formatted}. Перейти к заданиям`}
        >
          <CoinIcon className="size-4" />
          <span className="tabular-nums">{formatted}</span>
          <span className="flex size-5 items-center justify-center rounded-full bg-gold/25 text-[12px] font-bold text-gold">
            +
          </span>
        </button>
      </header>

      <section className="mb-4 overflow-hidden rounded-[24px] border border-[rgb(139_61_255/28%)] bg-[linear-gradient(180deg,#14101c,#0d0a14)] p-3 shadow-[0_0_28px_rgb(139_61_255/12%)]">
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: MINES_GRID_SIZE }, (_, index) => {
            const isRevealed = revealedSet.has(index)
            const isMine = mineSet.has(index)
            const showMine = Boolean(finished && isMine)
            const showSafe = isRevealed && !showMine
            const clickable = playing && !isRevealed && !busy

            return (
              <button
                key={index}
                type="button"
                disabled={!clickable}
                onClick={() => void handleReveal(index)}
                className={[
                  'mines-cell relative aspect-square rounded-[14px] border transition duration-200',
                  showSafe
                    ? 'border-[rgb(0_200_83/45%)] bg-[linear-gradient(160deg,#1a3a24,#102018)] shadow-[0_0_14px_rgb(0_200_83/25%)]'
                    : showMine
                      ? 'border-[rgb(255_80_80/50%)] bg-[linear-gradient(160deg,#3a1820,#1a0c12)] shadow-[0_0_16px_rgb(255_60_60/30%)] mines-cell-boom'
                      : 'border-white/[0.08] bg-[linear-gradient(160deg,#1c1728,#12101a)] shadow-[inset_0_0_0_1px_rgb(255_255_255/4%)]',
                  clickable ? 'active:scale-[0.94] hover:border-[rgb(139_61_255/45%)]' : '',
                  revealingCell === index ? 'scale-95' : '',
                ].join(' ')}
                aria-label={
                  showMine ? 'Мина' : showSafe ? 'Безопасно' : `Клетка ${index + 1}`
                }
              >
                <span
                  className={[
                    'pointer-events-none absolute inset-[18%] rounded-[10px] border',
                    showSafe
                      ? 'border-[rgb(0_200_83/35%)]'
                      : showMine
                        ? 'border-[rgb(255_100_100/35%)]'
                        : 'border-white/[0.06]',
                  ].join(' ')}
                  aria-hidden
                />
                {showSafe ? (
                  <Gem className="relative z-10 mx-auto size-[42%] text-[#5CFF9A]" aria-hidden />
                ) : null}
                {showMine ? (
                  <Bomb className="relative z-10 mx-auto size-[42%] text-[#FF8A80]" aria-hidden />
                ) : null}
              </button>
            )
          })}
        </div>
      </section>

      {playing || finished ? (
        <div className="mb-4 rounded-[18px] border border-[rgb(139_61_255/25%)] bg-[#120e1a] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab]">
                Текущий выигрыш
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xl font-bold text-white">
                <CoinIcon className="size-5" />
                {(game?.potentialWin || 0).toLocaleString('ru-RU')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-[#9b96ab]">×{(game?.multiplier || 1).toFixed(2)}</p>
              <p className="mt-1 text-xs text-[#9b96ab]">
                Ставка {game?.bet.toLocaleString('ru-RU')}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {!playing ? (
        <>
          <section className="mb-3 rounded-[20px] border border-white/[0.08] bg-[#120e1a] p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab]">
              Сумма ставки
            </p>
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                disabled={playing}
                onClick={() => updateBet(Math.floor(bet / 2))}
                className="flex size-11 items-center justify-center rounded-[12px] border border-white/10 bg-[#1a1524] text-sm font-bold text-white active:scale-95"
              >
                ½
              </button>
              <button
                type="button"
                disabled={playing}
                onClick={() => updateBet(bet * 2)}
                className="flex size-11 items-center justify-center rounded-[12px] border border-white/10 bg-[#1a1524] text-sm font-bold text-white active:scale-95"
              >
                2×
              </button>
              <div className="flex min-h-11 flex-1 items-center justify-between rounded-full border border-[rgb(139_61_255/35%)] bg-[#0c0914] px-4">
                <span className="text-lg font-bold tabular-nums text-white">
                  {bet.toLocaleString('ru-RU')}
                </span>
                <CoinIcon className="size-5" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {MINES_QUICK_BETS.map((value) => {
                const disabled = value > amount || playing
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
                        ? 'border-[rgb(139_61_255/70%)] bg-[rgb(139_61_255/25%)] text-white shadow-[0_0_12px_rgb(139_61_255/30%)]'
                        : 'border-white/10 bg-[#1a1524] text-[#cfc8df]',
                      disabled ? 'opacity-40' : 'active:scale-95',
                    ].join(' ')}
                  >
                    {value.toLocaleString('ru-RU')}
                  </button>
                )
              })}
            </div>
            {amount < MINES_MIN_BET ? (
              <p className="mt-3 text-xs text-amber-300/90">
                Нужно минимум {MINES_MIN_BET} монет. Выполни задания, чтобы пополнить баланс.
              </p>
            ) : null}
          </section>

          <section className="mb-4 rounded-[20px] border border-white/[0.08] bg-[#120e1a] p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab]">
                Количество мин
              </p>
              <span className="inline-flex items-center gap-1 rounded-full border border-[rgb(0_200_83/35%)] bg-[rgb(0_200_83/12%)] px-2.5 py-1 text-xs font-bold text-[#6CFFA0]">
                <span aria-hidden>💣</span>
                {mineCount}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {MINES_ALLOWED_COUNTS.map((value) => {
                const active = mineCount === value
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={playing}
                    onClick={() => setMineCount(value)}
                    className={[
                      'min-h-9 min-w-10 rounded-full border px-3 text-xs font-semibold transition',
                      active
                        ? 'border-[rgb(0_200_83/65%)] bg-[rgb(0_200_83/18%)] text-white shadow-[0_0_12px_rgb(0_200_83/25%)]'
                        : 'border-white/10 bg-[#1a1524] text-[#cfc8df]',
                      playing ? 'opacity-50' : 'active:scale-95',
                    ].join(' ')}
                  >
                    {value}
                  </button>
                )
              })}
            </div>
          </section>
        </>
      ) : null}

      {playing ? (
        <button
          type="button"
          disabled={busy || !game?.canCashout}
          onClick={() => void handleCashout()}
          className="mb-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(90deg,#20BFFF,#2196FF)] text-base font-bold text-white shadow-[0_0_24px_rgb(33_150_255/40%)] transition active:scale-[0.98] disabled:opacity-50"
        >
          <Star size={18} aria-hidden />
          Забрать выигрыш
        </button>
      ) : finished ? (
        <button
          type="button"
          onClick={handleNewRound}
          className="flex min-h-14 w-full items-center justify-center rounded-full bg-[#F5C842] text-base font-bold text-[#1a1200] shadow-[0_0_24px_rgb(245_200_66/35%)] transition active:scale-[0.98]"
        >
          Новая игра
        </button>
      ) : (
        <button
          type="button"
          disabled={!canStart || busy}
          onClick={() => void handleStart()}
          className="flex min-h-14 w-full items-center justify-center rounded-full bg-[#F5C842] text-base font-bold text-[#1a1200] shadow-[0_0_24px_rgb(245_200_66/35%)] transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'Запуск…' : 'Начать игру'}
        </button>
      )}
    </div>
  )
}
