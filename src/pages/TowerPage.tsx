import { ArrowLeft, Check, Skull, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CoinIcon } from '@/components/CoinIcon'
import { useNotifications } from '@/components/NotificationProvider'
import { useBalance } from '@/hooks/useBalance'
import { ROUTES } from '@/lib/constants'
import {
  cashoutTowerGame,
  fetchActiveTowerGame,
  pickTowerCell,
  startTowerGame,
} from '@/lib/tower'
import {
  buildTowerMultiplierTable,
  TOWER_CELLS_PER_FLOOR,
  TOWER_MAX_FLOORS,
  TOWER_MIN_BET,
  TOWER_QUICK_BETS,
  type TowerGame,
} from '@/types/tower'

function clampBet(value: number, balance: number): number {
  const maxAffordable = Math.max(0, Math.floor(balance))
  if (maxAffordable < TOWER_MIN_BET) {
    return TOWER_MIN_BET
  }
  return Math.min(Math.max(TOWER_MIN_BET, Math.floor(value)), maxAffordable)
}

function formatMult(value: number): string {
  return `${value.toFixed(2)}x`
}

export function TowerPage() {
  const navigate = useNavigate()
  const { amount, formatted } = useBalance()
  const { showNotification } = useNotifications()

  const [bet, setBet] = useState(TOWER_MIN_BET)
  const [game, setGame] = useState<TowerGame | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const [bootstrapped, setBootstrapped] = useState(false)

  const playing = game?.status === 'playing'
  const finished = game?.status === 'won' || game?.status === 'lost'
  const maxFloors = game?.maxFloors || TOWER_MAX_FLOORS
  const cellsPerFloor = game?.cellsPerFloor || TOWER_CELLS_PER_FLOOR

  const multiplierTable = useMemo(
    () => game?.multipliers?.length ? game.multipliers : buildTowerMultiplierTable(maxFloors),
    [game?.multipliers, maxFloors],
  )

  const pickByFloor = useMemo(() => {
    const map = new Map<number, NonNullable<TowerGame['picks']>[number]>()
    for (const pick of game?.picks || []) {
      map.set(pick.floor, pick)
    }
    return map
  }, [game?.picks])

  useEffect(() => {
    let cancelled = false
    void fetchActiveTowerGame().then((result) => {
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
    !playing && !busy && amount >= TOWER_MIN_BET && bet >= TOWER_MIN_BET && bet <= amount

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
      if (amount < TOWER_MIN_BET) {
        showNotification({
          type: 'warning',
          title: 'Недостаточно монет',
          message: `Минимальная ставка — ${TOWER_MIN_BET} монет.`,
        })
      }
      return
    }
    setBusy(true)
    try {
      const result = await startTowerGame({ bet })
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

  async function handlePick(floor: number, cellIndex: number) {
    if (!game || game.status !== 'playing' || busy || floor !== game.currentFloor) {
      return
    }
    const key = `${floor}:${cellIndex}`
    setBusy(true)
    setPicking(key)
    try {
      const result = await pickTowerCell({
        gameId: game.id,
        floor,
        cellIndex,
      })
      if (!result.success || !result.game) {
        showNotification({
          type: 'error',
          title: 'Ход не принят',
          message: result.message || 'Попробуй ещё раз.',
        })
        return
      }
      setGame(result.game)
      if (result.hitDanger) {
        showNotification({
          type: 'error',
          title: 'Проигрыш',
          message: 'Неверная клетка. Ставка сгорела.',
        })
      } else if (result.game.status === 'won') {
        showNotification({
          type: 'reward',
          title: 'Башня пройдена!',
          message: `+${(result.game.payout || 0).toLocaleString('ru-RU')} монет`,
        })
      }
    } finally {
      setBusy(false)
      setPicking(null)
    }
  }

  async function handleCashout() {
    if (!game || !game.canCashout || busy) {
      return
    }
    setBusy(true)
    try {
      const result = await cashoutTowerGame({ gameId: game.id })
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
        type: 'reward',
        title: 'Выигрыш забран',
        message: `+${(result.game.payout || 0).toLocaleString('ru-RU')} монет`,
      })
    } finally {
      setBusy(false)
    }
  }

  if (!bootstrapped) {
    return (
      <div className="ui-page flex min-h-[40vh] items-center justify-center text-sm text-muted">
        Загрузка Tower…
      </div>
    )
  }

  const floorsDesc = Array.from({ length: maxFloors }, (_, i) => maxFloors - i)

  return (
    <div className="tower-page ui-page pb-8">
      <header className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-[#16121f] text-white/80 transition active:scale-95"
          aria-label="Назад"
        >
          <ArrowLeft size={18} aria-hidden />
        </button>
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-xl font-bold tracking-wide text-white">
          <span
            className="flex size-8 items-center justify-center rounded-[10px] bg-[rgb(139_61_255/28%)] text-base"
            aria-hidden
          >
            🏗️
          </span>
          <span>TOWER</span>
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
        <div className="space-y-1.5">
          {floorsDesc.map((floor) => {
            const row = multiplierTable.find((item) => item.floor === floor)
            const pick = pickByFloor.get(floor)
            const isCurrent = playing && game?.currentFloor === floor
            const isCleared = (game?.floorsCleared || 0) >= floor
            const isFuture = playing && floor > (game?.currentFloor || 0)
            const safeForFloor =
              game?.safeCells && Array.isArray(game.safeCells)
                ? game.safeCells[floor - 1]
                : pick?.safeCell

            return (
              <div
                key={floor}
                className={[
                  'tower-floor grid grid-cols-[28px_1fr_58px] items-center gap-2 rounded-[14px] px-1.5 py-1 transition',
                  isCurrent
                    ? 'bg-[rgb(139_61_255/16%)] shadow-[0_0_18px_rgb(139_61_255/18%)]'
                    : isCleared
                      ? 'bg-[rgb(0_200_83/8%)]'
                      : '',
                  isFuture ? 'opacity-55' : '',
                ].join(' ')}
              >
                <span className="text-center text-xs font-semibold tabular-nums text-[#8f88a8]">
                  {floor}
                </span>

                <div className="grid grid-cols-3 gap-1.5">
                  {Array.from({ length: cellsPerFloor }, (_, cellIndex) => {
                    const selected = pick?.cell === cellIndex
                    const showSafeMark =
                      (isCleared && selected) ||
                      (finished && safeForFloor === cellIndex)
                    const showDanger =
                      Boolean(pick && !pick.safe && selected) ||
                      (finished &&
                        pick &&
                        !pick.safe &&
                        pick.floor === floor &&
                        selected)
                    const clickable = isCurrent && !busy

                    return (
                      <button
                        key={cellIndex}
                        type="button"
                        disabled={!clickable}
                        onClick={() => void handlePick(floor, cellIndex)}
                        className={[
                          'tower-cell relative flex h-10 items-center justify-center rounded-[12px] border text-sm font-bold transition duration-200',
                          showSafeMark
                            ? 'border-[rgb(0_200_83/50%)] bg-[linear-gradient(160deg,#1a3a24,#102018)] text-[#6CFFA0] shadow-[0_0_12px_rgb(0_200_83/25%)]'
                            : showDanger
                              ? 'border-[rgb(255_80_80/50%)] bg-[linear-gradient(160deg,#3a1820,#1a0c12)] text-[#FF8A80] tower-cell-shake'
                              : isCurrent
                                ? 'border-[rgb(139_61_255/40%)] bg-[linear-gradient(160deg,#221833,#14101c)] text-[#c9c0e0]'
                                : 'border-white/[0.08] bg-[linear-gradient(160deg,#1c1728,#12101a)] text-[#6f6884]',
                          clickable ? 'active:scale-[0.94] hover:border-[rgb(168_85_247/55%)]' : '',
                          picking === `${floor}:${cellIndex}` ? 'scale-95' : '',
                        ].join(' ')}
                        aria-label={`Этаж ${floor}, клетка ${cellIndex + 1}`}
                      >
                        {showSafeMark ? (
                          <Check size={16} aria-hidden />
                        ) : showDanger ? (
                          <Skull size={15} aria-hidden />
                        ) : pick && selected ? (
                          <X size={15} aria-hidden />
                        ) : (
                          '?'
                        )}
                      </button>
                    )
                  })}
                </div>

                <span
                  className={[
                    'text-right text-xs font-semibold tabular-nums',
                    isCurrent ? 'text-[#d2b4ff]' : 'text-[#8f88a8]',
                  ].join(' ')}
                >
                  {formatMult(row?.multiplier || 1)}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {playing || finished ? (
        <div className="mb-4 rounded-[18px] border border-[rgb(139_61_255/25%)] bg-[#120e1a] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab]">
                {finished && game?.status === 'won'
                  ? 'Выигрыш'
                  : finished
                    ? 'Результат'
                    : 'Потенциальный выигрыш'}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xl font-bold text-white">
                <CoinIcon className="size-5" />
                {(
                  finished && game?.status === 'won'
                    ? game.payout || 0
                    : game?.potentialWin || 0
                ).toLocaleString('ru-RU')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-[#9b96ab]">
                ×{(game?.multiplier || 1).toFixed(2)}
              </p>
              <p className="mt-1 text-xs text-[#9b96ab]">
                Этаж {game?.floorsCleared || 0}/{maxFloors}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {!playing ? (
        <section className="mb-3 rounded-[20px] border border-white/[0.08] bg-[#120e1a] p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab]">
            Сумма ставки
          </p>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateBet(Math.floor(bet / 2))}
              className="flex size-11 items-center justify-center rounded-[12px] border border-white/10 bg-[#1a1524] text-sm font-bold text-white active:scale-95"
            >
              ½
            </button>
            <div className="flex min-h-11 flex-1 items-center justify-between rounded-full border border-[rgb(139_61_255/35%)] bg-[#0c0914] px-4">
              <span className="text-lg font-bold tabular-nums text-white">
                {bet.toLocaleString('ru-RU')}
              </span>
              <CoinIcon className="size-5" />
            </div>
            <button
              type="button"
              onClick={() => updateBet(bet * 2)}
              className="flex size-11 items-center justify-center rounded-[12px] border border-white/10 bg-[#1a1524] text-sm font-bold text-white active:scale-95"
            >
              2×
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {TOWER_QUICK_BETS.map((value) => {
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
                      ? 'border-[rgb(139_61_255/70%)] bg-[rgb(139_61_255/25%)] text-white shadow-[0_0_12px_rgb(139_61_255/30%)]'
                      : 'border-white/10 bg-[#1a1524] text-[#cfc8df]',
                    disabled ? 'opacity-40' : 'active:scale-95',
                  ].join(' ')}
                >
                  {value.toLocaleString('ru-RU')}
                </button>
              )
            })}
            <button
              type="button"
              disabled={amount < TOWER_MIN_BET}
              onClick={() => updateBet(amount)}
              className={[
                'min-h-9 rounded-full border px-3 text-xs font-semibold transition',
                bet === clampBet(amount, amount) && amount >= TOWER_MIN_BET
                  ? 'border-gold/60 bg-gold/15 text-gold'
                  : 'border-white/10 bg-[#1a1524] text-[#cfc8df]',
                amount < TOWER_MIN_BET ? 'opacity-40' : 'active:scale-95',
              ].join(' ')}
            >
              МАКС
            </button>
          </div>
          {amount < TOWER_MIN_BET ? (
            <p className="mt-3 text-xs text-amber-300/90">
              Нужно минимум {TOWER_MIN_BET} монет. Выполни задания, чтобы пополнить баланс.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mb-4 rounded-[20px] border border-white/[0.08] bg-[#120e1a] p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#9b96ab]">
          Множители за этаж
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          {multiplierTable.map((row) => (
            <div key={row.floor} className="flex items-center justify-between text-[#cfc8df]">
              <span className="text-[#8f88a8]">Этаж {row.floor}</span>
              <span className="font-semibold tabular-nums text-[#d2b4ff]">
                {formatMult(row.multiplier)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-[#6f6884]">
          3 клетки · 1 безопасная · макс. 55.36× на 11 этаже
        </p>
      </section>

      {playing ? (
        <button
          type="button"
          disabled={!game?.canCashout || busy}
          onClick={() => void handleCashout()}
          className={[
            'mb-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-[16px] text-sm font-bold transition',
            game?.canCashout
              ? 'bg-gradient-to-r from-[#2bb673] to-[#1e9a5c] text-white shadow-[0_0_20px_rgb(43_182_115/28%)] active:scale-[0.98]'
              : 'cursor-not-allowed border border-white/10 bg-[#1a1524] text-[#6f6884]',
          ].join(' ')}
        >
          Забрать выигрыш
          {game?.canCashout ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
              {(game.potentialWin || 0).toLocaleString('ru-RU')}
              <CoinIcon className="size-4" />
            </span>
          ) : null}
        </button>
      ) : (
        <button
          type="button"
          disabled={!canStart || busy}
          onClick={() => void handleStart()}
          className={[
            'flex min-h-12 w-full items-center justify-center rounded-[16px] text-sm font-bold transition',
            canStart
              ? 'bg-gradient-to-r from-purple to-neon-purple text-white shadow-[0_4px_20px_rgb(139_92_246/28%)] active:scale-[0.98]'
              : 'cursor-not-allowed border border-white/10 bg-[#1a1524] text-[#6f6884]',
          ].join(' ')}
        >
          {finished ? 'Играть снова' : 'Начать игру'}
        </button>
      )}
    </div>
  )
}
