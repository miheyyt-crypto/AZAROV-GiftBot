import coinImage from '@/assets/cases/reward-coins.png'

export interface DailyFreeCaseReward {
  id: string
  name: string
  amount: number
  weight: number
  emoji: string
  /** Optional image; falls back to coin art. */
  image?: string
}

/** Keep weights/ids in sync with server/daily-free-case-config.mjs */
export const DAILY_FREE_CASE_COOLDOWN_MS = 24 * 60 * 60 * 1000

export const DAILY_FREE_CASE_REWARDS: DailyFreeCaseReward[] = [
  { id: 'dfc-1', name: '1 Coin', amount: 1, weight: 35, emoji: '⭐', image: coinImage },
  { id: 'dfc-3', name: '3 Coins', amount: 3, weight: 22, emoji: '⭐', image: coinImage },
  { id: 'dfc-15', name: '15 Coins', amount: 15, weight: 15, emoji: '🌟', image: coinImage },
  { id: 'dfc-50', name: 'Valentine Heart', amount: 50, weight: 12, emoji: '💝', image: coinImage },
  { id: 'dfc-500', name: 'Party Sparkler', amount: 500, weight: 8, emoji: '🎇', image: coinImage },
  { id: 'dfc-600', name: 'Snow Globe', amount: 600, weight: 5, emoji: '🔮', image: coinImage },
  { id: 'dfc-1100', name: 'Top Hat', amount: 1100, weight: 3, emoji: '🎩', image: coinImage },
]

export function getDailyFreeCaseRewardById(id: string): DailyFreeCaseReward | null {
  return DAILY_FREE_CASE_REWARDS.find((item) => item.id === id) ?? null
}
