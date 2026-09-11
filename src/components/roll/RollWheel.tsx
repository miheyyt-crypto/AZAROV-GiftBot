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

type RollWheelProps = {
  round: RollRound | null
  /** Server-synced countdown remaining ms (betting). */
  countdownMs: number | null
  /** Epoch ms when client received spin timing (for skew). */
  spinClock: { startedAtMs: number; endsAtMs: number; targetAngle: number } | null
  showConfetti: boolean
  confettiKey?: string | null
}

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

function AvatarOnWheel({
  segment,
  total,
}: {
  segment: RollSegment
  total: number
}) {
  if (total <= 0 || segment.sizeDeg < 8) {
    return null
  }
  const mid = segment.startDeg + segment.sizeDeg / 2
  // from -90deg in conic ⇒ mid 0 is top; place avatar along radius
  const rad = ((mid - 90) * Math.PI) / 180
  const r = 38
  const x = 50 + r * Math.cos(rad)
  const y = 50 + r * Math.sin(rad)
  return (
    <div
      className="pointer-events-none absolute size-9 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 border-[#0d0a14] bg-[#1a1524] shadow-md"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {segment.photoUrl ? (
        <img src={segment.photoUrl} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        <div className="flex size-full items-center justify-center text-[11px] font-bold text-white/80">
          {(segment.username || '?').slice(0, 1).toUpperCase()}
        </div>
      )}
    </div>
  )
}

export function RollWheel({ round, countdownMs, spinClock, showConfetti, confettiKey }: RollWheelProps) {
  const segments = useMemo(() => round?.segments || [], [round?.id, round?.status, round?.pot, round?.players])
  const [rotation, setRotation] = useState(0)
  const [pointerUser, setPointerUser] = useState<string | null>(null)
  const rafRef = useRef<number | null>(null)

  const conic = useMemo(() => buildConic(segments), [segments])
  const pot = round?.pot || 0
  const status = round?.status || 'waiting'
  const spinning = status === 'spinning' && spinClock

  useEffect(() => {
    if (!spinning || !spinClock) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (status === 'completed' && round?.targetAngle != null) {
        setRotation(round.targetAngle)
        const local = pointerLocalDeg(round.targetAngle)
        const seg = findSegmentAtLocalDeg(segments, local)
        setPointerUser(seg ? formatRollUser(seg) : null)
      } else if (status === 'waiting' || status === 'betting') {
        setRotation(0)
        setPointerUser(null)
      }
      return
    }

    const { startedAtMs, endsAtMs, targetAngle } = spinClock
    const duration = Math.max(1, endsAtMs - startedAtMs)

    const tick = () => {
      const now = Date.now()
      const t = Math.min(1, Math.max(0, (now - startedAtMs) / duration))
      const eased = easeOutQuart(t)
      const angle = targetAngle * eased
      setRotation(angle)
      const local = pointerLocalDeg(angle)
      const seg = findSegmentAtLocalDeg(segments, local)
      setPointerUser(seg ? formatRollUser(seg) : null)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [spinning, spinClock, status, round?.targetAngle, segments])

  const centerLabel = (() => {
    if (status === 'betting' && countdownMs != null) {
      const sec = Math.max(0, Math.ceil(countdownMs / 1000))
      const mm = String(Math.floor(sec / 60)).padStart(2, '0')
      const ss = String(sec % 60).padStart(2, '0')
      return { text: `${mm}:${ss}`, className: 'text-[28px] font-bold tabular-nums text-white' }
    }
    if (status === 'spinning' || status === 'locked' || status === 'completed') {
      return { text: 'ИГРА', className: 'text-[22px] font-extrabold tracking-wide text-[#8cff4a]' }
    }
    if (status === 'waiting') {
      return { text: pot > 0 ? String(pot) : '…', className: 'text-[20px] font-bold text-white/80' }
    }
    return { text: '…', className: 'text-[20px] font-bold text-white/50' }
  })()

  return (
    <div className="relative mx-auto mb-3 w-full max-w-[340px]">
      {(spinning || status === 'completed') && pointerUser ? (
        <div className="absolute left-1/2 top-0 z-30 -translate-x-1/2 -translate-y-1">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-[#1a1528]/95 px-3 py-1 shadow-lg backdrop-blur-sm">
            <span className="text-[12px] font-semibold text-white">{pointerUser}</span>
          </div>
        </div>
      ) : null}

      <div className="relative mx-auto aspect-square w-[min(100%,300px)]">
        {/* Pointer */}
        <div
          className="absolute left-1/2 top-1 z-20 -translate-x-1/2"
          aria-hidden
        >
          <div
            className="h-0 w-0 border-l-[10px] border-r-[10px] border-t-[16px] border-l-transparent border-r-transparent border-t-white"
            style={{ filter: 'drop-shadow(0 2px 2px rgb(0 0 0 / 55%))' }}
          />
          <div className="absolute left-1/2 top-[3px] h-0 w-0 -translate-x-1/2 border-l-[6px] border-r-[6px] border-t-[10px] border-l-transparent border-r-transparent border-t-[#121018]" />
        </div>

        <div className="relative size-full">
          <div
            className="absolute inset-0 rounded-full border-[3px] border-white/15 shadow-[0_0_40px_rgb(139_61_255/20%)]"
            style={{
              background: conic,
              transform: `rotate(${rotation}deg)`,
              willChange: 'transform',
            }}
          >
            {segments.map((seg) => (
              <AvatarOnWheel key={seg.userId} segment={seg} total={pot} />
            ))}
          </div>

          <div className="absolute inset-[22%] z-10 flex flex-col items-center justify-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_50%_40%,#1c1728,#0a0810)] shadow-[inset_0_0_24px_rgb(0_0_0/50%)]">
            {status === 'waiting' && pot > 0 ? (
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
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
    <p className="mt-1 px-2 text-center text-[10px] leading-tight text-white/40">
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
