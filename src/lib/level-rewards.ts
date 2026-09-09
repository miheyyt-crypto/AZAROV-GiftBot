/** Mirrors server/level-rewards.mjs — display only, never credits balance. */

export const LEVEL_REWARD_COINS_PER_LEVEL = 50

export function levelRewardAmount(level: number): number {
  const value = Math.floor(Number(level) || 0)
  if (value < 1) {
    return 0
  }
  return value * LEVEL_REWARD_COINS_PER_LEVEL
}

export function nextLevelRewardAmount(currentLevel: number): number {
  return levelRewardAmount(Math.max(1, Math.floor(Number(currentLevel) || 1)) + 1)
}

export interface LevelRewardGrant {
  level: number
  amount: number
}

export function parseLevelRewardGrants(raw: unknown): LevelRewardGrant[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: LevelRewardGrant[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const row = item as { level?: unknown; amount?: unknown }
    const level = Math.floor(Number(row.level) || 0)
    const amount = Math.floor(Number(row.amount) || 0)
    if (level >= 1 && amount > 0) {
      out.push({ level, amount })
    }
  }
  return out
}
