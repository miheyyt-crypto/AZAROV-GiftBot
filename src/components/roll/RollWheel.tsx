import { useEffect, useMemo, useRef, useState } from 'react'

import {
  easeOutSpin,
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
}

const MIN_AVATAR_DEG = 8
const MAX_AVATARS = 48
const OUTER_RATIO = 0.48
const HUB_RATIO = 0.165
const AVATAR_RATIO = 0.31
/** Waiting placeholder — matches reference 50/50 orange + lavender. */
const WAITING_ORANGE = '#ff6a2b'
const WAITING_PURPLE = '#b39ddb'

type AvatarCacheEntry = { img: HTMLImageElement; status: 'loading' | 'ready' | 'error' }

const avatarCache = new Map<string, AvatarCacheEntry>()

/**
 * Telegram CDN does not send CORS headers. Setting crossOrigin='anonymous'
 * causes the load to fail → letter fallback. Draw without CORS (display-only).
 */
function loadAvatar(url: string, onReady: () => void): AvatarCacheEntry | null {
  if (!url) {
    return null
  }
  const cached = avatarCache.get(url)
  if (cached) {
    return cached
  }
  const img = new Image()
  img.decoding = 'async'
  // Do NOT set crossOrigin — Telegram photo URLs are not CORS-enabled.
  const entry: AvatarCacheEntry = { img, status: 'loading' }
  avatarCache.set(url, entry)
  img.onload = () => {
    entry.status = 'ready'
    onReady()
  }
  img.onerror = () => {
    entry.status = 'error'
    onReady()
  }
  img.src = url
  return entry
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
  return spinClock.targetAngle * easeOutSpin(t)
}

function pickAvatarSegments(segments: RollSegment[]): RollSegment[] {
  const eligible = segments.filter((s) => s.sizeDeg >= MIN_AVATAR_DEG)
  if (eligible.length <= MAX_AVATARS) {
    return eligible
  }
  return [...eligible].sort((a, b) => b.sizeDeg - a.sizeDeg).slice(0, MAX_AVATARS)
}

export function RollWheel({ round, countdownMs, spinClock }: RollWheelProps) {
  const segments = useMemo(
    () => resolveRollSegments(round),
    [round?.id, round?.status, round?.pot, round?.version, round?.players, round?.segments],
  )
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rotationRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const spinLoopKeyRef = useRef<string | null>(null)
  const segmentsRef = useRef(segments)
  const statusRef = useRef(round?.status || 'waiting')
  const potRef = useRef(round?.pot || 0)
  const countdownRef = useRef(countdownMs)
  const lastNickRef = useRef<string | null>(null)
  const [pointerUser, setPointerUser] = useState<string | null>(null)
  const avatarTickRef = useRef(0)

  const pot = round?.pot || 0
  const status = round?.status || 'waiting'
  const showNick = status === 'spinning' || status === 'completed' || status === 'locked'

  segmentsRef.current = segments
  statusRef.current = status
  potRef.current = pot
  countdownRef.current = countdownMs

  const bumpAvatars = () => {
    avatarTickRef.current += 1
    // Repaint at current rotation without restarting the spin loop.
    paint(rotationRef.current)
  }

  const syncNickname = (angle: number, segs: RollSegment[]) => {
    const local = pointerLocalDeg(angle)
    const seg = findSegmentAtLocalDeg(segs, local)
    const nick = seg ? formatRollUser(seg) : null
    if (nick !== lastNickRef.current) {
      lastNickRef.current = nick
      setPointerUser(nick)
    }
  }

  const paint = (rotationDeg: number) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const segs = segmentsRef.current
    const curStatus = statusRef.current
    const curPot = potRef.current
    const curCountdown = countdownRef.current

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

    // Soft outer glow (screen space, under rotating content)
    const glow = ctx.createRadialGradient(cx, cy, outerR * 0.55, cx, cy, outerR * 1.18)
    glow.addColorStop(0, 'rgba(139,61,255,0.0)')
    glow.addColorStop(0.55, 'rgba(139,61,255,0.12)')
    glow.addColorStop(1, 'rgba(139,61,255,0)')
    ctx.beginPath()
    ctx.arc(cx, cy, outerR * 1.12, 0, Math.PI * 2)
    ctx.fillStyle = glow
    ctx.fill()

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((rotationDeg * Math.PI) / 180)

    const waitingPlaceholder = segs.length === 0
    if (waitingPlaceholder) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(0, 0, outerR, 0, Math.PI * 2)
      ctx.clip()
      // Two equal 180° sectors — orange then purple (reference waiting look)
      for (const [startDeg, endDeg, color] of [
        [0, 180, WAITING_ORANGE],
        [180, 360, WAITING_PURPLE],
      ] as const) {
        const start = ((startDeg - 90) * Math.PI) / 180
        const end = ((endDeg - 90) * Math.PI) / 180
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, outerR, start, end, false)
        ctx.closePath()
        ctx.fillStyle = color
        ctx.fill()
      }
      ctx.restore()
    } else {
      ctx.save()
      ctx.beginPath()
      ctx.arc(0, 0, outerR, 0, Math.PI * 2)
      ctx.clip()

      for (const seg of segs) {
        const start = ((seg.startDeg - 90) * Math.PI) / 180
        const end = ((seg.endDeg - 90) * Math.PI) / 180
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, outerR, start, end, false)
        ctx.closePath()
        ctx.fillStyle = seg.color
        ctx.fill()
      }
      ctx.restore()
    }

    const avatars = waitingPlaceholder ? [] : pickAvatarSegments(segs)
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

      const entry = seg.photoUrl ? loadAvatar(seg.photoUrl, bumpAvatars) : null
      if (entry?.status === 'ready') {
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.clip()
        ctx.drawImage(entry.img, x - r, y - r, r * 2, r * 2)
        ctx.restore()
      } else if (entry?.status === 'loading') {
        // Soft placeholder while photo loads — not a letter.
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        ctx.fill()
      } else {
        // No photo or load error → initial fallback.
        ctx.fillStyle = 'rgba(255,255,255,0.8)'
        ctx.font = `bold ${Math.max(10, r * 0.9)}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText((seg.username || '?').slice(0, 1).toUpperCase(), x, y + 0.5)
      }
    }

    ctx.restore()

    // Crisp rim + soft highlight
    ctx.beginPath()
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = Math.max(2, size * 0.014)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, outerR - size * 0.008, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = Math.max(1, size * 0.006)
    ctx.stroke()

    const grad = ctx.createRadialGradient(cx, cy - hubR * 0.25, 0, cx, cy, hubR)
    grad.addColorStop(0, '#241c34')
    grad.addColorStop(1, '#0a0810')
    ctx.beginPath()
    ctx.arc(cx, cy, hubR, 0, Math.PI * 2)
    ctx.fillStyle = '#0a0810'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.lineWidth = Math.max(1, size * 0.006)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, hubR - size * 0.004, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()

    const label = centerLabelText(curStatus, curCountdown, curPot, waitingPlaceholder)
    ctx.fillStyle = label.fill
    ctx.font = label.font(size)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label.text, cx, cy)
  }

  const applyRotation = (angle: number) => {
    rotationRef.current = angle
    paint(angle)
    syncNickname(angle, segmentsRef.current)
  }

  // Static / betting / completed paints — never restarts an active spin loop.
  useEffect(() => {
    if (spinLoopKeyRef.current) {
      // Spin loop owns painting; just refresh nickname/segments via next frame.
      return
    }
    paint(rotationRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, status, pot, countdownMs])

  // One continuous rAF loop per spin identity. Poll/SSE must NOT restart it.
  useEffect(() => {
    if (!spinClock || (status !== 'spinning' && status !== 'locked')) {
      if (status === 'completed' && round?.targetAngle != null) {
        spinLoopKeyRef.current = null
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        applyRotation(Number(round.targetAngle))
        return
      }
      if (status === 'waiting' || status === 'betting') {
        spinLoopKeyRef.current = null
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        applyRotation(0)
        lastNickRef.current = null
        setPointerUser(null)
      }
      return
    }

    const key = `${spinClock.roundId}:${spinClock.targetAngle}:${spinClock.startedAtMs}:${spinClock.endsAtMs}`
    if (spinLoopKeyRef.current === key && rafRef.current != null) {
      // Same frozen clock — keep running loop; do not restart.
      return
    }

    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    spinLoopKeyRef.current = key
    const clock = spinClock

    const tick = () => {
      const now = Date.now()
      const angle = rotationAt(clock, now)
      applyRotation(angle)
      if (now < clock.endsAtMs) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        applyRotation(clock.targetAngle)
        rafRef.current = null
      }
    }
    applyRotation(rotationAt(clock, Date.now()))
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      // Only cancel if this effect instance still owns the loop key.
      if (spinLoopKeyRef.current === key && rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
        spinLoopKeyRef.current = null
      }
    }
    // Intentionally omit segments — updates flow through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinClock, status, round?.targetAngle])

  useEffect(() => {
    const onResize = () => paint(rotationRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          className="size-full drop-shadow-[0_0_36px_rgb(139_61_255/28%)]"
          role="img"
          aria-label="Roll wheel"
        />
      </div>

      <p className="mt-3 text-center text-[13px] font-semibold text-white/55">
        {statusLabel(round)}
      </p>
    </div>
  )
}

function centerLabelText(
  status: string,
  countdownMs: number | null,
  pot: number,
  waitingPlaceholder: boolean,
): { text: string; fill: string; font: (size: number) => string } {
  if (waitingPlaceholder || (status === 'waiting' && pot <= 0)) {
    return {
      text: 'Ожидание',
      fill: '#ffffff',
      font: (size) => `700 ${Math.max(11, size * 0.042)}px system-ui, sans-serif`,
    }
  }
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
      text: pot > 0 ? pot.toLocaleString('ru-RU') : 'Ожидание',
      fill: 'rgba(255,255,255,0.92)',
      font: (size) => `700 ${Math.max(12, size * 0.045)}px system-ui, sans-serif`,
    }
  }
  return {
    text: 'Ожидание',
    fill: 'rgba(255,255,255,0.85)',
    font: (size) => `700 ${Math.max(11, size * 0.042)}px system-ui, sans-serif`,
  }
}

function statusLabel(round: RollRound | null): string {
  const status = round?.status
  const count = round?.players?.length || 0
  if (status === 'waiting') {
    if (count === 0) {
      return ''
    }
    return 'Ожидаем второго игрока...'
  }
  if (status === 'betting') {
    return 'Приём ставок'
  }
  if (status === 'locked' || status === 'spinning') {
    return '⚔️ PvP начался'
  }
  if (status === 'completed') {
    return 'Раунд завершён'
  }
  return ''
}
