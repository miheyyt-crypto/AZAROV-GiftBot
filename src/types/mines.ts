export type MinesGameStatus = 'playing' | 'won' | 'lost'

export type MinesGame = {
  id: string
  status: MinesGameStatus
  bet: number
  mineCount: number
  gridSize: number
  revealed: number[]
  safeOpened: number
  multiplierBps: number
  multiplier: number
  potentialWin: number
  payout: number | null
  canCashout: boolean
  mineIndices: number[] | null
  createdAt?: string
  finishedAt?: string | null
}

export const MINES_MIN_BET = 100
export const MINES_GRID_SIZE = 25
export const MINES_ALLOWED_COUNTS = [3, 5, 7, 10, 15, 20, 24] as const
export const MINES_QUICK_BETS = [100, 250, 500, 1000, 2500] as const
