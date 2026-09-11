import { useEffect, useMemo, useRef, useState } from 'react'

import { RollConfetti } from '@/components/roll/RollConfetti'
import {
  easeOutQuart,
  findSegmentAtLocalDeg,
  formatRollUser,
  pointerLocalDeg,
  type RollRound,
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

const CX = 50
const CY = 50
const OUTER_R = 48
const HUB_R = 16.5
/** Mid-ring radius for avatars (between hub and outer). */
const AVATAR_R = 31
const AVATAR_SIZE = 9

/** 0° at top, clockwise — matches server segment math & CSS rotate. */
function polar(r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: CX + r * Math.cos(rad),
    y: CY + r * Math.sin(rad),
  }
}

function segmentPath(startDeg: number, endDeg: number): string {
  const size = endDeg - startDeg
  if (size <= 0.001) {
    return ''
  }
  // Full circle special-case
  if (size >= 359.999) {
    return [
      `M ${CX} ${CY}`,
      `m 0 ${-OUTER_R}`,
      `a ${OUTER_R} ${OUTER_R} 0 1 1 0 ${OUTER_R * 2}`,
      `a ${OUTER_R} ${OUTER_R} 0 1 1 0 ${-OUTER_R * 2}`,
      'Z',
    ].join(' ')
  }
  const a = polar(OUTER_R, startDeg)
  const b = polar(OUTER_R, endDeg)
  const large = size > 180 ? 1 : 0
  // sweep=1 → clockwise in this polar convention
  return `M ${CX} ${CY} L ${a.x} ${a.y} A ${OUTER_R} ${OUTER_R} 0 ${large} 1 ${b.x} ${b.y} Z`
}

function avatarScaleForSegment(sizeDeg: number): number {
  if (sizeDeg >= 40) {
    return 1
  }
  if (sizeDeg >= 20) {
    return 0.85
  }
  if (sizeDeg >= 12) {
    return 0.7
  }
  return 0.55
}

function rotationAt(spinClock: RollSpinClock, nowMs: number): number {
  const duration = Math.max(1, spinClock.endsAtMs - spinClock.startedAtMs)
  const t = Math.min(1, Math.max(0, (nowMs - spinClock.startedAtMs) / duration))
  return spinClock.targetAngle * easeOutQuart(t)
}

export function RollWheel({ round, countdownMs, spinClock, showConfetti, confettiKey }: RollWheelProps) {
  const segments = useMemo(
    () => round?.segments || [],
    [round?.id, round?.status, round?.pot, round?.version, round?.players],
  )
  const wheelRef = useRef<SVGGElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastNickRef = useRef<string | null>(null)
  const [pointerUser, setPointerUser] = useState<string | null>(null)

  const pot = round?.pot || 0
  const status = round?.status || 'waiting'
  const showNick = status === 'spinning' || status === 'completed' || status === 'locked'

  const applyRotation = (angle: number) => {
    if (wheelRef.current) {
      wheelRef.current.setAttribute('transform', `rotate(${angle} ${CX} ${CY})`)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinClock, status, round?.targetAngle, segments])

  const centerLabel = (() => {
    if (status === 'betting' && countdownMs != null) {
      const sec = Math.max(0, Math.ceil(countdownMs / 1000))
      const mm = String(Math.floor(sec / 60)).padStart(2, '0')
      const ss = String(sec % 60).padStart(2, '0')
      return { text: `${mm}:${ss}`, className: 'fill-white text-[7px] font-bold' }
    }
    if (status === 'spinning' || status === 'locked' || status === 'completed') {
      return { text: 'ИГРА', className: 'fill-[#8cff4a] text-[6px] font-extrabold' }
    }
    if (status === 'waiting') {
      return {
        text: pot > 0 ? pot.toLocaleString('ru-RU') : '…',
        className: 'fill-white/85 text-[5.5px] font-bold',
      }
    }
    return { text: '…', className: 'fill-white/50 text-[5.5px] font-bold' }
  })()

  return (
    <div className="relative mx-auto mb-3 w-full max-w-[340px]">
      <div className="relative z-30 flex h-[56px] flex-col items-center justify-end pb-0.5">
        <div
          className={[
            'mb-1.5 flex h-7 max-w-[min(220px,70%)] items-center justify-center rounded-full border border-white/15 bg-[#1a1528]/95 px-3 shadow-lg backdrop-blur-sm transition-opacity',
            showNick && pointerUser ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        >
          <span className="truncate text-[12px] font-semibold text-white">
            {pointerUser || '\u00a0'}
          </span>
        </div>
        <div className="relative z-30" aria-hidden>
          <div
            className="h-0 w-0 border-l-[14px] border-r-[14px] border-t-[22px] border-l-transparent border-r-transparent border-t-white"
            style={{ filter: 'drop-shadow(0 3px 3px rgb(0 0 0 / 55%))' }}
          />
          <div className="absolute left-1/2 top-[4px] h-0 w-0 -translate-x-1/2 border-l-[9px] border-r-[9px] border-t-[14px] border-l-transparent border-r-transparent border-t-[#121018]" />
        </div>
      </div>

      <div className="relative mx-auto aspect-square w-[min(100%,300px)]">
        <svg
          viewBox="0 0 100 100"
          className="size-full overflow-visible drop-shadow-[0_0_28px_rgb(139_61_255/18%)]"
          role="img"
          aria-label="Roll wheel"
        >
          <defs>
            <clipPath id="roll-wheel-clip">
              <circle cx={CX} cy={CY} r={OUTER_R} />
            </clipPath>
          </defs>

          <g clipPath="url(#roll-wheel-clip)">
            <g ref={wheelRef} transform={`rotate(0 ${CX} ${CY})`}>
              {segments.length === 0 ? (
                <circle cx={CX} cy={CY} r={OUTER_R} fill="#1a1524" />
              ) : (
                segments.map((seg) => (
                  <path
                    key={seg.userId}
                    d={segmentPath(seg.startDeg, seg.endDeg)}
                    fill={seg.color}
                    stroke="rgba(0,0,0,0.25)"
                    strokeWidth={0.15}
                  />
                ))
              )}

              {segments.map((seg) => {
                if (seg.sizeDeg < 8) {
                  return null
                }
                const mid = seg.startDeg + seg.sizeDeg / 2
                const scale = avatarScaleForSegment(seg.sizeDeg)
                const size = AVATAR_SIZE * scale
                const clipId = `roll-av-${seg.userId}`
                return (
                  <g key={`av-${seg.userId}`} transform={`rotate(${mid} ${CX} ${CY})`}>
                    <g transform={`translate(${CX}, ${CY - AVATAR_R}) rotate(${-mid})`}>
                      <defs>
                        <clipPath id={clipId}>
                          <circle cx={0} cy={0} r={size / 2} />
                        </clipPath>
                      </defs>
                      <circle
                        cx={0}
                        cy={0}
                        r={size / 2 + 0.35}
                        fill="#0d0a14"
                        stroke="rgba(255,255,255,0.55)"
                        strokeWidth={0.45}
                      />
                      {seg.photoUrl ? (
                        <image
                          href={seg.photoUrl}
                          x={-size / 2}
                          y={-size / 2}
                          width={size}
                          height={size}
                          clipPath={`url(#${clipId})`}
                          preserveAspectRatio="xMidYMid slice"
                        />
                      ) : (
                        <text
                          x={0}
                          y={0.8}
                          textAnchor="middle"
                          className="fill-white/80 text-[3.2px] font-bold"
                        >
                          {(seg.username || '?').slice(0, 1).toUpperCase()}
                        </text>
                      )}
                    </g>
                  </g>
                )
              })}
            </g>
          </g>

          {/* Perfect outer ring on top of segments */}
          <circle
            cx={CX}
            cy={CY}
            r={OUTER_R}
            fill="none"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={1.2}
          />

          {/* Compact hub */}
          <defs>
            <radialGradient id="roll-hub-grad" cx="50%" cy="40%" r="70%">
              <stop offset="0%" stopColor="#1c1728" />
              <stop offset="100%" stopColor="#0a0810" />
            </radialGradient>
          </defs>
          <circle cx={CX} cy={CY} r={HUB_R} fill="#0a0810" stroke="rgba(255,255,255,0.12)" strokeWidth={0.6} />
          <circle cx={CX} cy={CY} r={HUB_R - 0.4} fill="url(#roll-hub-grad)" />
          {status === 'waiting' && pot > 0 ? (
            <text
              x={CX}
              y={CY - 4}
              textAnchor="middle"
              className="fill-white/40 text-[2.6px] font-semibold uppercase"
            >
              Всего
            </text>
          ) : null}
          <text x={CX} y={CY + 1.8} textAnchor="middle" className={centerLabel.className}>
            {centerLabel.text}
          </text>
        </svg>

        <RollConfetti active={showConfetti} burstKey={confettiKey} />
      </div>

      <p className="mt-3 text-center text-[14px] font-semibold text-white/85">
        {statusLabel(round)}
      </p>
    </div>
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
