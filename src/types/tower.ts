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
export const TOWER_HOUSE_EDGE_BPS = 9500
export const TOWER_QUICK_BETS = [100, 500, 1000, 5000, 10_000] as const

/** Mirrors server/tower.mjs — display only. */
export function towerMultiplierBps(floorsCleared: number): number {
  const k = Math.max(0, Math.floor(Number(floorsCleared) || 0))
  if (k <= 0) {
    return 10_000
  }
  let bps = 10_000
  for (let i = 0; i < k; i += 1) {
    bps = Math.floor((bps * TOWER_CELLS_PER_FLOOR * TOWER_HOUSE_EDGE_BPS) / 10_000)
  }
  return bps
}

export function getTowerMultiplier(floorsCleared: number): number {
  return Number((towerMultiplierBps(floorsCleared) / 10_000).toFixed(4))
}

export function buildTowerMultiplierTable(maxFloors = TOWER_MAX_FLOORS): TowerMultiplierRow[] {
  return Array.from({ length: maxFloors }, (_, index) => {
    const floor = index + 1
    const bps = towerMultiplierBps(floor)
    return {
      floor,
      multiplierBps: bps,
      multiplier: Number((bps / 10_000).toFixed(4)),
    }
  })
}
