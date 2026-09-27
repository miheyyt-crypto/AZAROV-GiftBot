/** Canonical Mines multipliers — do not recalculate from house edge. */

export const MINES_BOARD_SIZE = 25;
export const MINES_MIN_BET = 100n;
export const MINES_MAX_BET = 10_000n;

export const SUPPORTED_MINE_COUNTS = Object.freeze([
  3, 5, 7, 10, 15, 20, 24,
] as const);

export type SupportedMineCount = (typeof SUPPORTED_MINE_COUNTS)[number];

/** Display strings preserve trailing zeros where product requires (e.g. 65.70). */
export const MINES_MULTIPLIERS: Readonly<
  Record<SupportedMineCount, readonly string[]>
> = Object.freeze({
  3: Object.freeze([
    "1.14",
    "1.30",
    "1.49",
    "1.73",
    "2.02",
    "2.37",
    "2.82",
    "3.38",
    "4.11",
    "5.05",
    "6.32",
    "8.04",
    "10.45",
    "13.94",
    "19.17",
    "27.38",
    "41.07",
    "65.70",
    "115",
    "230",
    "575",
    "2300",
  ]),
  5: Object.freeze([
    "1.25",
    "1.58",
    "2.02",
    "2.61",
    "3.43",
    "4.57",
    "6.20",
    "8.59",
    "12.16",
    "17.69",
    "26.54",
    "41.28",
    "67.08",
    "115",
    "210.83",
    "421.67",
    "948.75",
    "2530",
    "8855",
    "53130",
  ]),
  7: Object.freeze([
    "1.39",
    "1.96",
    "2.82",
    "4.13",
    "6.20",
    "9.54",
    "15.10",
    "24.72",
    "42.02",
    "74.70",
    "140.06",
    "280.13",
    "606.94",
    "1456.67",
    "4005.83",
    "13352.78",
    "60087.50",
    "480700",
  ]),
  10: Object.freeze([
    "1.67",
    "2.86",
    "5.05",
    "9.27",
    "17.69",
    "35.38",
    "74.70",
    "168.08",
    "408.19",
    "1088.50",
    "3265.49",
    "11429.23",
    "49526.67",
    "297160",
    "3268760",
  ]),
  15: Object.freeze([
    "2.50",
    "6.67",
    "19.17",
    "60.24",
    "210.83",
    "843.33",
    "4005.83",
    "24035",
    "204297.50",
    "3268760",
  ]),
  20: Object.freeze(["5.00", "30", "230", "2530", "53130"]),
  24: Object.freeze(["25"]),
});

export function isSupportedMineCount(value: number): value is SupportedMineCount {
  return (SUPPORTED_MINE_COUNTS as readonly number[]).includes(value);
}

/** First-click hit chance: selected mines / 25 remaining cells. */
export function firstClickLossProbability(mineCount: number): number {
  return mineCount / MINES_BOARD_SIZE;
}

export function safeCellCount(mineCount: SupportedMineCount): number {
  return MINES_BOARD_SIZE - mineCount;
}

export function multiplierForSafePicks(
  mineCount: SupportedMineCount,
  safePickCount: number,
): string | null {
  if (safePickCount <= 0) {
    return null;
  }
  const table = MINES_MULTIPLIERS[mineCount];
  return table[safePickCount - 1] ?? null;
}
