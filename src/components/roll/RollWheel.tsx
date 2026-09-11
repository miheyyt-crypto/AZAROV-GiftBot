import { useEffect, useMemo, useRef, useState } from 'react'

import { RollConfetti } from '@/components/roll/RollConfetti'
import {
  easeOutQuint,
  findSegmentAtLocalDeg,
  formatRollUser,
  pointerLocalDeg,
  resolveRollSegments,
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

const MIN_AVATAR_DEG = 8
const MAX_AVATARS = 48
const OUTER_RATIO = 0.48
const HUB_RATIO = 0.165
const AVATAR_RATIO = 0.31

const avatarCache = new Map<string, HTMLImageElement | 'error'>()

function loadAvatar(url: string, onReady: () => void): HTMLImageElement | null {
  if (!url) {
    return null
  }
  const cached = avatarCache.get(url)
  if (cached === 'error') {
    return null
  }
  if (cached instanceof HTMLImageElement) {
    return cached.complete ? cached : null
  }
  const img = new Image()
  img.decoding = 'async'
  img.crossOrigin = 'anonymous'
  avatarCache.set(url, img)
  img.onload = () => onReady()
  img.onerror = () => {
    avatarCache.set(url, 'error')
    onReady()
  }
  img.src = url
  return null
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
  return spinClock.targetAngle * easeOutQuint(t)
}

function pickAvatarSegments(segments: RollSegment[]): RollSegment[] {
  const eligible = segments.filter((s) => s.sizeDeg >= MIN_AVATAR_DEG)
  if (eligible.length <= MAX_AVATARS) {
    return eligible
  }
  return [...eligible].sort((a, b) => b.sizeDeg - a.sizeDeg).slice(0, MAX_AVATARS)
}

export function RollWheel({ round, countdownMs, spinClock, showConfetti, confettiKey }: RollWheelProps) {
  const segments = useMemo(
    () => resolveRollSegments(round),
    [round?.id, round?.status, round?.pot, round?.version, round?.players, round?.segments],
  )
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rotationRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastNickRef = useRef<string | null>(null)
  const [pointerUser, setPointerUser] = useState<string | null>(null)
  const [avatarTick, setAvatarTick] = useState(0)

  const pot = round?.pot || 0
  const status = round?.status || 'waiting'
  const showNick = status === 'spinning' || status === 'completed' || status === 'locked'

  const bumpAvatars = () => setAvatarTick((n) => n + 1)

  const paint = (rotationDeg: number) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssSize = canvas.clientWidth || 300
    const px = Math.max(1, Math.floor(cssSize * dpr))
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px
      canvas.height = px
    }

    const size = canvas.width
    const cx = size / 2
    const cy = size / 2
    const outerR = size * OUTER_RATIO
    const hubR = size * HUB_RATIO
    const avatarR = size * AVATAR_RATIO
    const baseAvatar = size * 0.09

    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((rotationDeg * Math.PI) / 180)

    if (segments.length === 0) {
      ctx.beginPath()
      ctx.arc(0, 0, outerR, 0, Math.PI * 2)
      ctx.fillStyle = '#1a1524'
      ctx.fill()
    } else {
      ctx.save()
      ctx.beginPath()
      ctx.arc(0, 0, outerR, 0, Math.PI * 2)
      ctx.clip()

      for (const seg of segments) {
        const start = ((seg.startDeg - 90) * Math.PI) / 180
        const end = ((seg.endDeg - 90) * Math.PI) / 180
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, outerR, start, end, false)
        ctx.closePath()
        ctx.fillStyle = seg.color
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'
        ctx.lineWidth = Math.max(0.5, size * 0.0015)
        ctx.stroke()
      }
      ctx.restore()
    }

    const avatars = pickAvatarSegments(segments)
    for (const seg of avatars) {
      const mid = seg.startDeg + seg.sizeDeg / 2
      const rad = ((mid - 90) * Math.PI) / 180
      const x = Math.cos(rad) * avatarR
      const y = Math.sin(rad) * avatarR
      const scale = avatarScaleForSegment(seg.sizeDeg)
      const r = (baseAvatar * scale) / 2

      ctx.beginPath()
      ctx.arc(x, y, r + size * 0.0035, 0, Math.PI * 2)
      ctx.fillStyle = '#0d0a14'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = Math.max(1, size * 0.0045)
      ctx.stroke()

      const img = seg.photoUrl ? loadAvatar(seg.photoUrl, bumpAvatars) : null
      if (img) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(img, x - r, y - r, r * 2, r * 2)
        ctx.restore()
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.8)'
        ctx.font = `bold ${Math.max(10, r * 0.9)}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText((seg.username || '?').slice(0, 1).toUpperCase(), x, y + 0.5)
      }
    }

    ctx.restore()

    // Outer ring (screen space — does not rotate with wheel content borders already clipped)
    ctx.beginPath()
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.lineWidth = Math.max(2, size * 0.012)
    ctx.stroke()

    // Hub
    const grad = ctx.createRadialGradient(cx, cy - hubR * 0.2, 0, cx, cy, hubR)
    grad.addColorStop(0, '#1c1728')
    grad.addColorStop(1, '#0a0810')
    ctx.beginPath()
    ctx.arc(cx, cy, hubR, 0, Math.PI * 2)
    ctx.fillStyle = '#0a0810'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = Math.max(1, size * 0.006)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, hubR - size * 0.004, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()

    // Center label
    const label = centerLabelText(status, countdownMs, pot)
    ctx.fillStyle = label.fill
    ctx.font = label.font(size)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (status === 'waiting' && pot > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.font = `600 ${Math.max(9, size * 0.026)}px system-ui, sans-serif`
      ctx.fillText('Всего', cx, cy - size * 0.04)
      ctx.fillStyle = label.fill
      ctx.font = label.font(size)
      ctx.fillText(label.text, cx, cy + size * 0.018)
    } else {
      ctx.fillText(label.text, cx, cy)
    }
  }

  const syncNickname = (angle: number) => {
    const local = pointerLocalDeg(angle)
    const seg = findSegmentAtLocalDeg(segments, local)
    const nick = seg ? formatRollUser(seg) : null
    if (nick !== lastNickRef.current) {
      lastNickRef.current = nick
      setPointerUser(nick)
    }
  }

  const applyRotation = (angle: number) => {
    rotationRef.current = angle
    paint(angle)
    syncNickname(angle)
  }

  useEffect(() => {
    paint(rotationRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, status, pot, countdownMs, avatarTick])

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

  useEffect(() => {
    const onResize = () => paint(rotationRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, status, pot, countdownMs])

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
        <canvas
          ref={canvasRef}
          className="size-full drop-shadow-[0_0_28px_rgb(139_61_255/18%)]"
          role="img"
          aria-label="Roll wheel"
        />
        <RollConfetti active={showConfetti} burstKey={confettiKey} />
      </div>

      <p className="mt-3 text-center text-[14px] font-semibold text-white/85">
        {statusLabel(round)}
      </p>
    </div>
  )
}

function centerLabelText(
  status: string,
  countdownMs: number | null,
  pot: number,
): { text: string; fill: string; font: (size: number) => string } {
  if (status === 'betting' && countdownMs != null) {
    const sec = Math.max(0, Math.ceil(countdownMs / 1000))
    const mm = String(Math.floor(sec / 60)).padStart(2, '0')
    const ss = String(sec % 60).padStart(2, '0')
    return {
      text: `${mm}:${ss}`,
      fill: '#ffffff',
      font: (size) => `700 ${Math.max(18, size * 0.07)}px system-ui, sans-serif`,
    }
  }
  if (status === 'spinning' || status === 'locked' || status === 'completed') {
    return {
      text: 'ИГРА',
      fill: '#8cff4a',
      font: (size) => `800 ${Math.max(14, size * 0.06)}px system-ui, sans-serif`,
    }
  }
  if (status === 'waiting') {
    return {
      text: pot > 0 ? pot.toLocaleString('ru-RU') : '…',
      fill: 'rgba(255,255,255,0.85)',
      font: (size) => `700 ${Math.max(14, size * 0.055)}px system-ui, sans-serif`,
    }
  }
  return {
    text: '…',
    fill: 'rgba(255,255,255,0.5)',
    font: (size) => `700 ${Math.max(14, size * 0.055)}px system-ui, sans-serif`,
  }
}

function statusLabel(round: RollRound | null): string {
  const status = round?.status
  if (status === 'waiting') {
    return 'Ожидаем первую ставку...'
  }
  if (status === 'betting') {
    return 'Приём ставок'
  }
  if (status === 'locked' || status === 'spinning') {
    return '⚔️ PvP начался'
  }
  if (status === 'completed') {
    return '⚔️ PvP завершён'
  }
  return ''
}
