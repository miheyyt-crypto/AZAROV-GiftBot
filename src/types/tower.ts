export type TowerGameStatus = 'playing' | 'won' | 'lost'

export type TowerPick = {
  floor: number
  cell: number
  safe: boolean
  safeCell?: number
}

export type TowerMultiplierRow = {
  floor: number
  multiplierBps: number
  multiplier: number
}

export type TowerGame = {
  id: string
  status: TowerGameStatus
  bet: number
  cellsPerFloor: number
  maxFloors: number
  currentFloor: number
  floorsCleared: number
  picks: TowerPick[]
  multiplierBps: number
  multiplier: number
  potentialWin: number
  payout: number | null
  canCashout: boolean
  multipliers: TowerMultiplierRow[]
  safeCells: number[] | null
  createdAt?: string
  finishedAt?: string | null
}

export const TOWER_MIN_BET = 100
export const TOWER_CELLS_PER_FLOOR = 3
export const TOWER_MAX_FLOORS = 11
export const TOWER_QUICK_BETS = [100, 500, 1000, 5000, 10_000] as const

/** Fixed reference multipliers — mirrors server/tower.mjs exactly. */
export const TOWER_MULTIPLIERS = [
  1.0, 1.44, 2.16, 3.24, 4.86, 7.29, 10.93, 16.4, 24.6, 36.91, 55.36,
] as const

export const TOWER_MULTIPLIER_BPS = [
  10_000, 14_400, 21_600, 32_400, 48_600, 72_900, 109_300, 164_000, 246_000, 369_100, 553_600,
] as const

/** floorsCleared N → multiplier for floor N in the reference table. */
export function towerMultiplierBps(floorsCleared: number): number {
  const k = Math.max(0, Math.floor(Number(floorsCleared) || 0))
  if (k <= 0) {
    return TOWER_MULTIPLIER_BPS[0]
  }
  const index = Math.min(k, TOWER_MULTIPLIER_BPS.length) - 1
  return TOWER_MULTIPLIER_BPS[index]
}

export function getTowerMultiplier(floorsCleared: number): number {
  const k = Math.max(0, Math.floor(Number(floorsCleared) || 0))
  if (k <= 0) {
    return TOWER_MULTIPLIERS[0]
  }
  const index = Math.min(k, TOWER_MULTIPLIERS.length) - 1
  return TOWER_MULTIPLIERS[index]
}

export function buildTowerMultiplierTable(maxFloors = TOWER_MAX_FLOORS): TowerMultiplierRow[] {
  const floors = Math.min(
    TOWER_MULTIPLIERS.length,
    Math.max(1, Math.floor(Number(maxFloors) || TOWER_MAX_FLOORS)),
  )
  return Array.from({ length: floors }, (_, index) => ({
    floor: index + 1,
    multiplierBps: TOWER_MULTIPLIER_BPS[index],
    multiplier: TOWER_MULTIPLIERS[index],
  }))
}
