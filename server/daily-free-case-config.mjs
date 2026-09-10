/** Shared reward table for daily free case (server). Keep in sync with src/data/daily-free-case.ts */

export const DAILY_FREE_CASE_COOLDOWN_MS = 24 * 60 * 60 * 1000

export const DAILY_FREE_CASE_REWARDS = [
  { id: 'dfc-1', name: '1 Coin', amount: 1, weight: 35, emoji: '⭐' },
  { id: 'dfc-3', name: '3 Coins', amount: 3, weight: 22, emoji: '⭐' },
  { id: 'dfc-15', name: '15 Coins', amount: 15, weight: 15, emoji: '🌟' },
  { id: 'dfc-50', name: 'Valentine Heart', amount: 50, weight: 12, emoji: '💝' },
  { id: 'dfc-500', name: 'Party Sparkler', amount: 500, weight: 8, emoji: '🎇' },
  { id: 'dfc-600', name: 'Snow Globe', amount: 600, weight: 5, emoji: '🔮' },
  { id: 'dfc-1100', name: 'Top Hat', amount: 1100, weight: 3, emoji: '🎩' },
]

export function getDailyFreeCaseRewardById(rewardId) {
  return DAILY_FREE_CASE_REWARDS.find((item) => item.id === rewardId) || null
}

export function rollDailyFreeCaseReward(rng = Math.random) {
  const total = DAILY_FREE_CASE_REWARDS.reduce((sum, item) => sum + item.weight, 0)
  let cursor = rng() * total
  for (const item of DAILY_FREE_CASE_REWARDS) {
    cursor -= item.weight
    if (cursor <= 0) {
      return item
    }
  }
  return DAILY_FREE_CASE_REWARDS[DAILY_FREE_CASE_REWARDS.length - 1]
}

export function getDailyFreeCaseAvailability(user, nowMs = Date.now()) {
  const lastAt = user?.lastDailyFreeCaseAt ? Date.parse(user.lastDailyFreeCaseAt) : NaN
  if (!Number.isFinite(lastAt)) {
    return {
      available: true,
      availableAt: null,
      remainingMs: 0,
    }
  }

  const availableAtMs = lastAt + DAILY_FREE_CASE_COOLDOWN_MS
  const remainingMs = Math.max(0, availableAtMs - nowMs)
  return {
    available: remainingMs <= 0,
    availableAt: new Date(availableAtMs).toISOString(),
    remainingMs,
  }
}
