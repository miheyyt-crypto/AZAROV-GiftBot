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
/** Wheel fills most of the square canvas. */
const OUTER_RATIO = 0.49
/** Hub ≈ 28% of wheel diameter (reference). */
const HUB_RATIO = 0.137
const AVATAR_RATIO = 0.32

/** Waiting state — translucent purple glass wedges (reference screenshot). */
const WAITING_SEGMENTS = 8
const WAITING_COLOR_A = 'rgba(148, 112, 198, 0.55)'
const WAITING_COLOR_B = 'rgba(78, 52, 128, 0.50)'
const SEGMENT_ALPHA = 0.72

type AvatarCacheEntry = { img: HTMLImageElement; status: 'loading' | 'ready' | 'error' }

const avatarCache = new Map<string, AvatarCacheEntry>()

function hexToRgba(hex: string, alpha: number): string {
  const raw = String(hex || '').replace('#', '').trim()
  if (raw.length !== 3 && raw.length !== 6) {
    return `rgba(139, 61, 255, ${alpha})`
  }
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n)) {
    return `rgba(139, 61, 255, ${alpha})`
  }
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

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

function drawWedge(
  ctx: CanvasRenderingContext2D,
  outerR: number,
  startDeg: number,
  endDeg: number,
  fill: string,
) {
  const start = ((startDeg - 90) * Math.PI) / 180
  const end = ((endDeg - 90) * Math.PI) / 180
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.arc(0, 0, outerR, start, end, false)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
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
    const baseAvatar = size * 0.085

    ctx.clearRect(0, 0, size, size)

    // Soft ambient glow under the disc
    const glow = ctx.createRadialGradient(cx, cy, outerR * 0.65, cx, cy, outerR * 1.15)
    glow.addColorStop(0, 'rgba(120, 70, 200, 0)')
    glow.addColorStop(0.7, 'rgba(120, 70, 200, 0.14)')
    glow.addColorStop(1, 'rgba(80, 40, 160, 0)')
    ctx.beginPath()
    ctx.arc(cx, cy, outerR * 1.1, 0, Math.PI * 2)
    ctx.fillStyle = glow
    ctx.fill()

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((rotationDeg * Math.PI) / 180)

    // Strict circular clip — no color escapes the rim
    ctx.save()
    ctx.beginPath()
    ctx.arc(0, 0, outerR, 0, Math.PI * 2)
    ctx.clip()

    const waitingPlaceholder = segs.length === 0
    if (waitingPlaceholder) {
      const slice = 360 / WAITING_SEGMENTS
      for (let i = 0; i < WAITING_SEGMENTS; i += 1) {
        drawWedge(
          ctx,
          outerR,
          i * slice,
          (i + 1) * slice,
          i % 2 === 0 ? WAITING_COLOR_A : WAITING_COLOR_B,
        )
      }
    } else {
      for (const seg of segs) {
        drawWedge(ctx, outerR, seg.startDeg, seg.endDeg, hexToRgba(seg.color, SEGMENT_ALPHA))
      }
    }

    // Soft radial vignette inside the glass disc
    const innerShade = ctx.createRadialGradient(0, 0, hubR * 0.8, 0, 0, outerR)
    innerShade.addColorStop(0, 'rgba(8, 4, 18, 0)')
    innerShade.addColorStop(0.72, 'rgba(8, 4, 18, 0)')
    innerShade.addColorStop(1, 'rgba(4, 2, 12, 0.28)')
    ctx.beginPath()
    ctx.arc(0, 0, outerR, 0, Math.PI * 2)
    ctx.fillStyle = innerShade
    ctx.fill()

    // Soft top highlight for glass
    const highlight = ctx.createLinearGradient(0, -outerR, 0, outerR * 0.2)
    highlight.addColorStop(0, 'rgba(255, 255, 255, 0.1)')
    highlight.addColorStop(0.45, 'rgba(255, 255, 255, 0)')
    ctx.beginPath()
    ctx.arc(0, 0, outerR, 0, Math.PI * 2)
    ctx.fillStyle = highlight
    ctx.fill()

    const avatars = waitingPlaceholder ? [] : pickAvatarSegments(segs)
    for (const seg of avatars) {
      const mid = seg.startDeg + seg.sizeDeg / 2
      const rad = ((mid - 90) * Math.PI) / 180
      const x = Math.cos(rad) * avatarR
      const y = Math.sin(rad) * avatarR
      const scale = avatarScaleForSegment(seg.sizeDeg)
      const r = (baseAvatar * scale) / 2

      ctx.beginPath()
      ctx.arc(x, y, r + size * 0.003, 0, Math.PI * 2)
      ctx.fillStyle = '#0d0a14'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.lineWidth = Math.max(1.2, size * 0.004)
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
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        ctx.fill()
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.font = `bold ${Math.max(10, r * 0.9)}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText((seg.username || '?').slice(0, 1).toUpperCase(), x, y + 0.5)
      }
    }

    ctx.restore() // clip
    ctx.restore() // rotation

    // Thin outer rim (perfect circle, screen space)
    ctx.beginPath()
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(200, 170, 255, 0.35)'
    ctx.lineWidth = Math.max(1.5, size * 0.007)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, outerR - size * 0.005, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.lineWidth = Math.max(1, size * 0.005)
    ctx.stroke()

    // Dark glass hub
    const hubGrad = ctx.createRadialGradient(cx, cy - hubR * 0.3, 0, cx, cy, hubR)
    hubGrad.addColorStop(0, '#2a2038')
    hubGrad.addColorStop(0.55, '#14101c')
    hubGrad.addColorStop(1, '#08060e')
    ctx.beginPath()
    ctx.arc(cx, cy, hubR, 0, Math.PI * 2)
    ctx.fillStyle = hubGrad
    ctx.fill()
    ctx.strokeStyle = 'rgba(180, 150, 230, 0.18)'
    ctx.lineWidth = Math.max(1, size * 0.005)
    ctx.stroke()
    // Soft inner hub glow
    const hubGlow = ctx.createRadialGradient(cx, cy, hubR * 0.2, cx, cy, hubR)
    hubGlow.addColorStop(0, 'rgba(120, 80, 200, 0.12)')
    hubGlow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.beginPath()
    ctx.arc(cx, cy, hubR, 0, Math.PI * 2)
    ctx.fillStyle = hubGlow
    ctx.fill()

    const label = centerLabelText(
      curStatus,
      curCountdown,
      curPot,
      waitingPlaceholder,
      segs.length,
    )
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

  useEffect(() => {
    if (spinLoopKeyRef.current) {
      return
    }
    paint(rotationRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, status, pot, countdownMs])

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
      if (spinLoopKeyRef.current === key && rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
        spinLoopKeyRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinClock, status, round?.targetAngle])

  useEffect(() => {
    const onResize = () => paint(rotationRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="relative mx-auto mb-2 w-full max-w-[min(82vw,360px)]">
      {/* Nickname above pointer */}
      <div className="relative z-30 flex h-[50px] flex-col items-center justify-end">
        <div
          className={[
            'mb-0.5 flex h-7 max-w-[min(220px,70%)] items-center justify-center rounded-full border border-white/15 bg-[#1a1528]/95 px-3 shadow-lg backdrop-blur-sm transition-opacity',
            showNick && pointerUser ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        >
          <span className="truncate text-[12px] font-semibold text-white">
            {pointerUser || '\u00a0'}
          </span>
        </div>
        {/* Pointer — rounded triangle, white stroke + dark fill, above rim */}
        <svg
          className="relative z-30 translate-y-[3px] drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)]"
          width="32"
          height="28"
          viewBox="0 0 32 28"
          aria-hidden
        >
          <path
            d="M16 25.5 C15.2 25.5 14.5 25.1 14.1 24.4 L3.4 5.8 C2.7 4.5 3.6 2.8 5.2 2.8 L26.8 2.8 C28.4 2.8 29.3 4.5 28.6 5.8 L17.9 24.4 C17.5 25.1 16.8 25.5 16 25.5 Z"
            fill="#121018"
            stroke="#ffffff"
            strokeWidth="3.2"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="relative z-10 mx-auto aspect-square w-full">
        <canvas
          ref={canvasRef}
          className="size-full"
          role="img"
          aria-label="Roll wheel"
        />
      </div>

      <p className="mt-2.5 text-center text-[13px] font-semibold text-white/55">
        {statusLabel(round)}
      </p>
    </div>
  )
}

function centerLabelText(
  status: string,
  countdownMs: number | null,
  _pot: number,
  waitingPlaceholder: boolean,
  playerCount: number,
): { text: string; fill: string; font: (size: number) => string } {
  if (waitingPlaceholder || (status === 'waiting' && playerCount === 0)) {
    return {
      text: 'Ожидание',
      fill: '#ffffff',
      font: (size) => `700 ${Math.max(13, Math.round(size * 0.042))}px system-ui, sans-serif`,
    }
  }
  if (status === 'betting' && countdownMs != null) {
    const sec = Math.max(0, Math.ceil(countdownMs / 1000))
    const mm = String(Math.floor(sec / 60)).padStart(2, '0')
    const ss = String(sec % 60).padStart(2, '0')
    return {
      text: `${mm}:${ss}`,
      fill: '#ffffff',
      font: (size) => `700 ${Math.max(18, size * 0.068)}px system-ui, sans-serif`,
    }
  }
  if (status === 'spinning' || status === 'locked' || status === 'completed') {
    return {
      text: 'Игра',
      fill: '#ffffff',
      font: (size) => `800 ${Math.max(14, size * 0.05)}px system-ui, sans-serif`,
    }
  }
  if (status === 'waiting') {
    return {
      text: 'Игра',
      fill: '#ffffff',
      font: (size) => `700 ${Math.max(13, size * 0.045)}px system-ui, sans-serif`,
    }
  }
  return {
    text: 'Ожидание',
    fill: '#ffffff',
    font: (size) => `700 ${Math.max(12, size * 0.04)}px system-ui, sans-serif`,
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
