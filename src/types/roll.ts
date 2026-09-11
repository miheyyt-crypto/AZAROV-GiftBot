export const ROLL_MAX_PLAYERS = 2
export const ROLL_MIN_BET = 100
export const ROLL_BETTING_DURATION_MS = 20_000
export const ROLL_SPIN_DURATION_MS = 5_000
export const ROLL_RESULT_HOLD_MS = 8_000
export const ROLL_POLL_MS_ACTIVE = 800
export const ROLL_POLL_MS_IDLE = 2_500
export const ROLL_QUICK_BETS = [100, 250, 500, 1000, 2500] as const

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
  players: RollPlayer[]
  segments: RollSegment[]
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

/** Ease-out quart — shared client spin curve. */
export function easeOutQuart(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return 1 - (1 - x) ** 4
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
  const name = String(player.firstName || '').trim()
  return name || 'Игрок'
}
