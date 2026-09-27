/**
 * Exact copies of V1 payout helpers (E:\AZAROV-GiftBot\server\mines.mjs + tower.mjs).
 * Do not change constants or formulas independently of V1.
 */

export const MINES_GRID_SIZE = 25;
export const MINES_HOUSE_EDGE_BPS = 9700;
export const MINES_ALLOWED_COUNTS = Object.freeze([3, 5, 7, 10, 15, 20, 24]);

export const TOWER_MULTIPLIER_BPS = Object.freeze([
  10_000, 14_400, 21_600, 32_400, 48_600, 72_900, 109_300, 164_000, 246_000, 369_100, 553_600,
]);

export function minesMultiplierBps(
  safeOpened: number,
  mineCount: number,
  gridSize = MINES_GRID_SIZE,
  houseEdgeBps = MINES_HOUSE_EDGE_BPS,
): number {
  const k = Math.max(0, Math.floor(Number(safeOpened) || 0));
  const mines = Math.floor(Number(mineCount) || 0);
  const n = Math.floor(Number(gridSize) || MINES_GRID_SIZE);
  const safeTotal = n - mines;

  if (k <= 0) {
    return 10_000;
  }
  if (mines < 1 || mines >= n || k > safeTotal) {
    return 0;
  }

  let num = 1n;
  let den = 1n;
  for (let i = 0; i < k; i += 1) {
    num *= BigInt(n - i);
    den *= BigInt(safeTotal - i);
  }

  const edge = BigInt(Math.max(1, Math.floor(Number(houseEdgeBps) || MINES_HOUSE_EDGE_BPS)));
  return Number((num * edge) / den);
}

export function minesPotentialWin(
  bet: number,
  safeOpened: number,
  mineCount: number,
  gridSize = MINES_GRID_SIZE,
  houseEdgeBps = MINES_HOUSE_EDGE_BPS,
): number {
  const stake = Math.max(0, Math.floor(Number(bet) || 0));
  const bps = minesMultiplierBps(safeOpened, mineCount, gridSize, houseEdgeBps);
  if (stake <= 0 || bps <= 0) {
    return 0;
  }
  return Math.floor((stake * bps) / 10_000);
}

export function towerMultiplierBps(floorsCleared: number): number {
  const k = Math.max(0, Math.floor(Number(floorsCleared) || 0));
  if (k <= 0) {
    return TOWER_MULTIPLIER_BPS[0] ?? 10_000;
  }
  const index = Math.min(k, TOWER_MULTIPLIER_BPS.length) - 1;
  return TOWER_MULTIPLIER_BPS[index] ?? 0;
}

export function towerPotentialWin(bet: number, floorsCleared: number): number {
  const stake = Math.max(0, Math.floor(Number(bet) || 0));
  const bps = towerMultiplierBps(floorsCleared);
  if (stake <= 0 || bps <= 0) {
    return 0;
  }
  return Math.floor((stake * bps) / 10_000);
}
