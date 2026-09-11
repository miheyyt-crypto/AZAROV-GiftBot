export const ROLL_MAX_PLAYERS = 1000
export const ROLL_MIN_BET = 100
export const ROLL_BETTING_DURATION_MS = 20_000
export const ROLL_SPIN_DURATION_MS = 10_000
export const ROLL_RESULT_HOLD_MS = 8_000
export const ROLL_POLL_MS_ACTIVE = 2_000
export const ROLL_POLL_MS_IDLE = 5_000
export const ROLL_POLL_MS_SPIN = 1_500
export const ROLL_QUICK_BETS = [100, 250, 500, 1000, 2500] as const
export const ROLL_SEGMENTS_INLINE_MAX = 64

const SEGMENT_PALETTE = [
  '#ff6a2b',
  '#b39ddb',
  '#4fc3f7',
  '#66bb6a',
  '#ffca28',
  '#ef5350',
  '#26c6da',
  '#ab47bc',
  '#ffa726',
  '#42a5f5',
  '#ec407a',
  '#8d6e63',
]

export type RollRoundStatus = 'waiting' | 'betting' | 'locked' | 'spinning' | 'completed'

export type RollPlayer = {
  userId: number
  username: string
  firstName: string
  photoUrl: string
  bet: number
  chance: number
  joinedAt: string | null
}

export type RollSegment = {
  userId: number
  username: string
  photoUrl: string
  bet: number
  startDeg: number
  endDeg: number
  sizeDeg: number
  chance: number
  color: string
}

export type RollRound = {
  id: string
  displayId: number
  status: RollRoundStatus
  version?: number
  updatedAt?: string
  players: RollPlayer[]
  segments: RollSegment[]
  playerCount?: number
  pot: number
  payout: number
  bettingStartedAt: string | null
  bettingEndsAt: string | null
  spinStartedAt: string | null
  spinEndsAt: string | null
  targetAngle: number | null
  winnerUserId: number | null
  winner: RollPlayer | null
  winnerChance: number | null
  multiplier: number | null
  settledAt: string | null
  completedAt: string | null
  createdAt: string
  maxPlayers: number
}

export type RollGameCard = {
  roundId: string
  displayId: number
  winnerUsername: string
  winnerUserId: number
  winnerPhotoUrl: string
  winnerChance: number
  winnings: number
  multiplier: number
  createdAt: string
}

export type RollConfig = {
  maxPlayers: number
  minBet: number
  bettingDurationMs: number
  spinDurationMs: number
  resultHoldMs: number
  payoutBps: number
  quickBets: number[]
}

export type RollStatePayload = {
  success: boolean
  message?: string
  code?: string
  alreadyProcessed?: boolean
  round: RollRound | null
  lastResult: RollRound | null
  previousGame: RollGameCard | null
  topGame: RollGameCard | null
  serverNow: string
  serverNowMs: number
  viewerInRound: boolean
  config: RollConfig
}

/** Smooth long deceleration for 10s spin (continuous derivative, soft stop). */
export function easeOutSpin(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  // Power 6 → fast start, long soft tail; no discontinuous jump at t=0/1.
  return 1 - (1 - x) ** 6
}

/** @deprecated alias — prefer easeOutSpin */
export function easeOutQuint(t: number): number {
  return easeOutSpin(t)
}

/** @deprecated use easeOutSpin */
export function easeOutQuart(t: number): number {
  return easeOutSpin(t)
}

export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

export function pointerLocalDeg(rotationDeg: number): number {
  return normalizeDeg(-rotationDeg)
}

export function findSegmentAtLocalDeg(
  segments: RollSegment[],
  localDeg: number,
): RollSegment | null {
  const angle = normalizeDeg(localDeg)
  for (const seg of segments) {
    if (angle >= seg.startDeg && angle < seg.endDeg) {
      return seg
    }
  }
  return segments.length ? segments[segments.length - 1] : null
}

export function formatRollUser(player: { username?: string; firstName?: string } | null): string {
  if (!player) {
    return '—'
  }
  const username = String(player.username || '').trim()
  if (username) {
    return username.startsWith('@') ? username : `@${username}`
  }
  return String(player.firstName || '').trim() || 'игрок'
}

/** Russian plural for «N игрок/игрока/игроков». */
export function formatPlayersCountLabel(count: number): string {
  const n = Math.abs(Math.floor(count))
  const mod100 = n % 100
  const mod10 = n % 10
  if (mod100 > 10 && mod100 < 20) {
    return `${n} Игроков`
  }
  if (mod10 === 1) {
    return `${n} Игрок`
  }
  if (mod10 > 1 && mod10 < 5) {
    return `${n} Игрока`
  }
  return `${n} Игроков`
}

/** Rebuild wheel segments from players (matches server geometry). */
export function buildRollSegments(players: RollPlayer[]): RollSegment[] {
  const list = Array.isArray(players) ? players : []
  const total = list.reduce((sum, p) => sum + (Number(p.bet) || 0), 0)
  if (total <= 0 || list.length === 0) {
    return []
  }
  let cursor = 0
  return list.map((player, index) => {
    const bet = Number(player.bet) || 0
    const size = (360 * bet) / total
    const start = cursor
    const end = cursor + size
    cursor = end
    return {
      userId: Number(player.userId),
      username: player.username || '',
      photoUrl: player.photoUrl || '',
      bet,
      startDeg: start,
      endDeg: end,
      sizeDeg: size,
      chance: Math.round((bet / total) * 10000) / 100,
      color: SEGMENT_PALETTE[index % SEGMENT_PALETTE.length],
    }
  })
}

export function resolveRollSegments(round: RollRound | null): RollSegment[] {
  if (!round) {
    return []
  }
  if (round.segments?.length) {
    return round.segments
  }
  return buildRollSegments(round.players || [])
}
