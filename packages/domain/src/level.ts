export const MAX_LEVEL = 50;
export const TOTAL_XP_TO_MAX_LEVEL = 2_307_800n;

export type LevelTransition = {
  fromLevel: number;
  toLevel: number;
  xpToNext: bigint;
  cumulativeXp: bigint;
  rewardAzc: bigint;
};

/**
 * Canonical 1–50 progression (product-decided).
 * Each row is XP required for the next level + AZC reward on reaching `toLevel`.
 * Cumulative XP to level 50 is exactly 2_307_800.
 */
const TRANSITION_ROWS: ReadonlyArray<{ xpToNext: bigint; rewardAzc: bigint }> =
  Object.freeze([
    { xpToNext: 200n, rewardAzc: 100n },
    { xpToNext: 400n, rewardAzc: 200n },
    { xpToNext: 700n, rewardAzc: 300n },
    { xpToNext: 1000n, rewardAzc: 500n },
    { xpToNext: 1500n, rewardAzc: 750n },
    { xpToNext: 2000n, rewardAzc: 1000n },
    { xpToNext: 3000n, rewardAzc: 1500n },
    { xpToNext: 4000n, rewardAzc: 2000n },
    { xpToNext: 5000n, rewardAzc: 5000n },
    { xpToNext: 6000n, rewardAzc: 3000n },
    { xpToNext: 7000n, rewardAzc: 3500n },
    { xpToNext: 8000n, rewardAzc: 4000n },
    { xpToNext: 9000n, rewardAzc: 4500n },
    { xpToNext: 10000n, rewardAzc: 5000n },
    { xpToNext: 12000n, rewardAzc: 6000n },
    { xpToNext: 14000n, rewardAzc: 7000n },
    { xpToNext: 16000n, rewardAzc: 8000n },
    { xpToNext: 18000n, rewardAzc: 9000n },
    { xpToNext: 20000n, rewardAzc: 15000n },
    { xpToNext: 22000n, rewardAzc: 11000n },
    { xpToNext: 24000n, rewardAzc: 12000n },
    { xpToNext: 26000n, rewardAzc: 13000n },
    { xpToNext: 28000n, rewardAzc: 14000n },
    { xpToNext: 30000n, rewardAzc: 15000n },
    { xpToNext: 33000n, rewardAzc: 16500n },
    { xpToNext: 36000n, rewardAzc: 18000n },
    { xpToNext: 39000n, rewardAzc: 19500n },
    { xpToNext: 42000n, rewardAzc: 21000n },
    { xpToNext: 45000n, rewardAzc: 30000n },
    { xpToNext: 48000n, rewardAzc: 24000n },
    { xpToNext: 51000n, rewardAzc: 25500n },
    { xpToNext: 54000n, rewardAzc: 27000n },
    { xpToNext: 57000n, rewardAzc: 28500n },
    { xpToNext: 60000n, rewardAzc: 30000n },
    { xpToNext: 65000n, rewardAzc: 32500n },
    { xpToNext: 70000n, rewardAzc: 35000n },
    { xpToNext: 75000n, rewardAzc: 37500n },
    { xpToNext: 80000n, rewardAzc: 40000n },
    { xpToNext: 85000n, rewardAzc: 60000n },
    { xpToNext: 90000n, rewardAzc: 45000n },
    { xpToNext: 95000n, rewardAzc: 47500n },
    { xpToNext: 100000n, rewardAzc: 50000n },
    { xpToNext: 105000n, rewardAzc: 52500n },
    { xpToNext: 110000n, rewardAzc: 55000n },
    { xpToNext: 120000n, rewardAzc: 60000n },
    { xpToNext: 130000n, rewardAzc: 65000n },
    { xpToNext: 140000n, rewardAzc: 70000n },
    { xpToNext: 150000n, rewardAzc: 75000n },
    { xpToNext: 160000n, rewardAzc: 100000n },
  ]);

function buildLevelTable(): readonly LevelTransition[] {
  const rows: LevelTransition[] = [];
  let cumulativeXp = 0n;
  for (let index = 0; index < TRANSITION_ROWS.length; index += 1) {
    const row = TRANSITION_ROWS[index];
    if (!row) {
      continue;
    }
    cumulativeXp += row.xpToNext;
    rows.push({
      fromLevel: index + 1,
      toLevel: index + 2,
      xpToNext: row.xpToNext,
      cumulativeXp,
      rewardAzc: row.rewardAzc,
    });
  }
  return Object.freeze(rows);
}

export const LEVEL_TABLE: readonly LevelTransition[] = buildLevelTable();

export const XP_TO_NEXT_LEVEL: readonly bigint[] = Object.freeze(
  LEVEL_TABLE.map((row) => row.xpToNext),
);

export type LevelProgress = {
  current: number;
  totalXp: bigint;
  currentLevelXp: bigint;
  nextLevelXp: bigint | null;
  xpNeededForNext: bigint | null;
  progressRatio: number;
  nextRewardAzc: bigint | null;
};

function ratio(current: bigint, next: bigint): number {
  if (next <= 0n) {
    return 1;
  }
  const value = Number(current) / Number(next);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function computeLevel(totalXp: bigint): LevelProgress {
  return getLevelProgress(totalXp);
}

export function getLevelProgress(totalXp: bigint): LevelProgress {
  let remaining = totalXp < 0n ? 0n : totalXp;
  let current = 1;
  for (const row of LEVEL_TABLE) {
    if (remaining < row.xpToNext) {
      return {
        current,
        totalXp: totalXp < 0n ? 0n : totalXp,
        currentLevelXp: remaining,
        nextLevelXp: row.xpToNext,
        xpNeededForNext: row.xpToNext - remaining,
        progressRatio: ratio(remaining, row.xpToNext),
        nextRewardAzc: row.rewardAzc,
      };
    }
    remaining -= row.xpToNext;
    current = row.toLevel;
  }
  return {
    current: MAX_LEVEL,
    totalXp: totalXp < 0n ? 0n : totalXp,
    currentLevelXp: remaining,
    nextLevelXp: null,
    xpNeededForNext: null,
    progressRatio: 1,
    nextRewardAzc: null,
  };
}

export function xpToReachLevel(level: number): bigint {
  if (level <= 1) {
    return 0n;
  }
  const capped = Math.min(level, MAX_LEVEL);
  const row = LEVEL_TABLE[capped - 2];
  return row?.cumulativeXp ?? TOTAL_XP_TO_MAX_LEVEL;
}

export function serializeLevel(progress: LevelProgress) {
  return {
    current: progress.current,
    totalXp: progress.totalXp.toString(),
    currentLevelXp: progress.currentLevelXp.toString(),
    nextLevelXp: progress.nextLevelXp?.toString() ?? null,
    xpNeededForNext: progress.xpNeededForNext?.toString() ?? null,
    progressRatio: progress.progressRatio,
    nextRewardAzc: progress.nextRewardAzc?.toString() ?? null,
  };
}

/** Reward AZC granted when reaching `reachedLevel` (transition fromLevel → reachedLevel). */
export function rewardForReachedLevel(reachedLevel: number): bigint | null {
  if (reachedLevel < 2 || reachedLevel > MAX_LEVEL) {
    return null;
  }
  return LEVEL_TABLE[reachedLevel - 2]?.rewardAzc ?? null;
}
