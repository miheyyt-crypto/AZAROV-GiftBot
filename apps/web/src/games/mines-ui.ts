export const MINES_MIN_BET = 100;
export const MINES_MAX_BET = 10_000;
export const MINES_QUICK_BETS = [100, 250, 500, 1000, 2500] as const;
export const MINES_BOARD_CELLS = 25;

export function clampMinesBet(value: number): number {
  return Math.min(MINES_MAX_BET, Math.max(MINES_MIN_BET, Math.floor(value) || MINES_MIN_BET));
}
