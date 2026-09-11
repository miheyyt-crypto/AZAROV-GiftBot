import { useEffect, useMemo, useRef, useState } from 'react'

import { RollConfetti } from '@/components/roll/RollConfetti'
import {
  easeOutQuart,
  findSegmentAtLocalDeg,
  formatRollUser,
  pointerLocalDeg,
  type RollRound,
  type RollSegment,
} from '@/types/roll'

export type RollSpinClock = {
  roundId: string
  startedAtMs: number
  endsAtMs: number
  targetAngle: number
}

type RollWheelProps = {
  round: RollRound | null
  countdownMs: number | null
  spinClock: RollSpinClock | null
  showConfetti: boolean
  confettiKey?: string | null
}

/** Distance from wheel center to avatar center, as % of wheel radius (0–50). */
const AVATAR_RADIUS_PCT = 34
const AVATAR_MIN_SEGMENT_DEG = 12

function buildConic(segments: RollSegment[]): string {
  if (!segments.length) {
    return 'conic-gradient(from -90deg, #2a2438 0deg, #1a1524 360deg)'
  }
  const parts: string[] = []
  for (const seg of segments) {
    parts.push(`${seg.color} ${seg.startDeg}deg ${seg.endDeg}deg`)
  }
  return `conic-gradient(from -90deg, ${parts.join(', ')})`
}

/**
 * Place avatar on segment mid-angle.
 * conic-gradient(from -90deg) ⇒ 0° at top, clockwise — same as CSS rotate().
 * Structure: rotate(mid) → push toward top → counter-rotate for upright face.
 */
function AvatarOnWheel({ segment }: { segment: RollSegment }) {
  if (segment.sizeDeg < AVATAR_MIN_SEGMENT_DEG) {
    return null
  }
  const mid = segment.startDeg + segment.sizeDeg / 2
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ transform: `rotate(${mid}deg)` }}
    >
      <div
        className="absolute left-1/2 size-8 -translate-x-1/2 overflow-hidden rounded-full border-2 border-[#0d0a14] bg-[#1a1524] shadow-[0_2px_8px_rgb(0_0_0/45%)] sm:size-9"
        style={{
          top: `calc(50% - ${AVATAR_RADIUS_PCT}%)`,
          transform: `translate(-50%, -50%) rotate(${-mid}deg)`,
        }}
      >
        {segment.photoUrl ? (
          <img src={segment.photoUrl} alt="" className="size-full object-cover" draggable={false} />
        ) : (
          <div className="flex size-full items-center justify-center text-[11px] font-bold text-white/80">
            {(segment.username || '?').slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
    </div>
  )
}

function rotationAt(spinClock: RollSpinClock, nowMs: number): number {
  const duration = Math.max(1, spinClock.endsAtMs - spinClock.startedAtMs)
  const t = Math.min(1, Math.max(0, (nowMs - spinClock.startedAtMs) / duration))
  return spinClock.targetAngle * easeOutQuart(t)
}

export function RollWheel({ round, countdownMs, spinClock, showConfetti, confettiKey }: RollWheelProps) {
  const segments = useMemo(
    () => round?.segments || [],
    [round?.id, round?.status, round?.pot, round?.players],
  )
  const wheelRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastNickRef = useRef<string | null>(null)
  const [pointerUser, setPointerUser] = useState<string | null>(null)

  const conic = useMemo(() => buildConic(segments), [segments])
  const pot = round?.pot || 0
  const status = round?.status || 'waiting'
  const showNick = status === 'spinning' || status === 'completed' || status === 'locked'

  const applyRotation = (angle: number) => {
    if (wheelRef.current) {
      wheelRef.current.style.transform = `rotate(${angle}deg)`
    }
    const local = pointerLocalDeg(angle)
    const seg = findSegmentAtLocalDeg(segments, local)
    const nick = seg ? formatRollUser(seg) : null
    if (nick !== lastNickRef.current) {
      lastNickRef.current = nick
      setPointerUser(nick)
    }
  }

  useEffect(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    if (spinClock && (status === 'spinning' || status === 'locked')) {
      const tick = () => {
        const angle = rotationAt(spinClock, Date.now())
        applyRotation(angle)
        if (Date.now() < spinClock.endsAtMs) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          applyRotation(spinClock.targetAngle)
          rafRef.current = null
        }
      }
      // Late join / reconnect: jump to current server timeline position immediately.
      applyRotation(rotationAt(spinClock, Date.now()))
      rafRef.current = requestAnimationFrame(tick)
      return () => {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
      }
    }

    if (status === 'completed' && round?.targetAngle != null) {
      applyRotation(Number(round.targetAngle))
      return
    }

    if (status === 'waiting' || status === 'betting') {
      applyRotation(0)
      lastNickRef.current = null
      setPointerUser(null)
    }

    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyRotation closes over segments
  }, [spinClock, status, round?.targetAngle, segments])

  const centerLabel = (() => {
    if (status === 'betting' && countdownMs != null) {
      const sec = Math.max(0, Math.ceil(countdownMs / 1000))
      const mm = String(Math.floor(sec / 60)).padStart(2, '0')
      const ss = String(sec % 60).padStart(2, '0')
      return { text: `${mm}:${ss}`, className: 'text-[18px] font-bold tabular-nums leading-none text-white' }
    }
    if (status === 'spinning' || status === 'locked' || status === 'completed') {
      return { text: 'ИГРА', className: 'text-[15px] font-extrabold tracking-wide text-[#8cff4a]' }
    }
    if (status === 'waiting') {
      return {
        text: pot > 0 ? pot.toLocaleString('ru-RU') : '…',
        className: 'text-[14px] font-bold tabular-nums text-white/85',
      }
    }
    return { text: '…', className: 'text-[14px] font-bold text-white/50' }
  })()

  return (
    <div className="relative mx-auto mb-3 w-full max-w-[340px]">
      {/* Fixed header: nickname ABOVE pointer — never overlaps */}
      <div className="relative z-30 flex h-[52px] flex-col items-center justify-end pb-0.5">
        <div
          className={[
            'mb-1 flex h-7 max-w-[min(220px,70%)] items-center justify-center rounded-full border border-white/15 bg-[#1a1528]/95 px-3 shadow-lg backdrop-blur-sm transition-opacity',
            showNick && pointerUser ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        >
          <span className="truncate text-[12px] font-semibold text-white">
            {pointerUser || '\u00a0'}
          </span>
        </div>
        <div className="relative z-30" aria-hidden>
          <div
            className="h-0 w-0 border-l-[13px] border-r-[13px] border-t-[20px] border-l-transparent border-r-transparent border-t-white"
            style={{ filter: 'drop-shadow(0 3px 3px rgb(0 0 0 / 55%))' }}
          />
          <div className="absolute left-1/2 top-[4px] h-0 w-0 -translate-x-1/2 border-l-[8px] border-r-[8px] border-t-[12px] border-l-transparent border-r-transparent border-t-[#121018]" />
        </div>
      </div>

      <div className="relative mx-auto aspect-square w-[min(100%,300px)]">
        <div className="relative size-full">
          <div
            ref={wheelRef}
            className="absolute inset-0 rounded-full border-[3px] border-white/15 shadow-[0_0_40px_rgb(139_61_255/20%)] will-change-transform"
            style={{
              background: conic,
              transform: 'rotate(0deg)',
            }}
          >
            {segments.map((seg) => (
              <AvatarOnWheel key={seg.userId} segment={seg} />
            ))}
          </div>

          {/* Compact center hub (~36% diameter vs previous ~56%) */}
          <div className="absolute inset-[32%] z-10 flex flex-col items-center justify-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_50%_40%,#1c1728,#0a0810)] shadow-[inset_0_0_18px_rgb(0_0_0/55%)]">
            {status === 'waiting' && pot > 0 ? (
              <p className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide text-white/40">
                Всего
              </p>
            ) : null}
            <p className={centerLabel.className}>{centerLabel.text}</p>
            {status === 'waiting' && playersWaitingLabel(round)}
          </div>
        </div>

        <RollConfetti active={showConfetti} burstKey={confettiKey} />
      </div>

      <p className="mt-3 text-center text-[14px] font-semibold text-white/85">
        {statusLabel(round)}
      </p>
    </div>
  )
}

function playersWaitingLabel(round: RollRound | null) {
  if (!round || round.status !== 'waiting') {
    return null
  }
  const need = Math.max(0, (round.maxPlayers || 2) - (round.players?.length || 0))
  if (need <= 0) {
    return null
  }
  return (
    <p className="mt-0.5 px-1 text-center text-[8px] leading-tight text-white/40">
      Ждём ещё {need}
    </p>
  )
}

function statusLabel(round: RollRound | null): string {
  const status = round?.status
  if (status === 'waiting') {
    return (round?.players?.length || 0) < (round?.maxPlayers || 2)
      ? 'Ожидаем второго игрока...'
      : 'Готово к старту'
  }
  if (status === 'betting') {
    return 'Ставки приняты — отсчёт'
  }
  if (status === 'locked' || status === 'spinning') {
    return '⚔️ PvP начался'
  }
  if (status === 'completed') {
    return '⚔️ PvP завершён'
  }
  return ''
}
