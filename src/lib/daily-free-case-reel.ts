import {
  CASE_OPENING_DURATION_MS,
  CASE_OPENING_REEL_LENGTH,
  CASE_OPENING_WINNER_INDEX_MAX,
  CASE_OPENING_WINNER_INDEX_MIN,
  computeReelTranslateX,
  randomIntInclusive,
} from '@/lib/case-opening-reel'
import {
  DAILY_FREE_CASE_REWARDS,
  getDailyFreeCaseRewardById,
  type DailyFreeCaseReward,
} from '@/data/daily-free-case'

export { CASE_OPENING_DURATION_MS, computeReelTranslateX }

export interface DailyFreeCaseReelItem {
  key: string
  reward: DailyFreeCaseReward
  isWinner: boolean
}

function pickReward(pool: DailyFreeCaseReward[], rng: () => number): DailyFreeCaseReward {
  return pool[randomIntInclusive(0, pool.length - 1, rng)]!
}

export function buildDailyFreeCaseReel(
  winner: DailyFreeCaseReward,
  rng = Math.random,
): { items: DailyFreeCaseReelItem[]; winnerIndex: number } {
  const pool = DAILY_FREE_CASE_REWARDS
  const length = CASE_OPENING_REEL_LENGTH
  const winnerIndex = randomIntInclusive(
    CASE_OPENING_WINNER_INDEX_MIN,
    Math.min(CASE_OPENING_WINNER_INDEX_MAX, length - 3),
    rng,
  )

  const items: DailyFreeCaseReelItem[] = []
  for (let i = 0; i < length; i += 1) {
    if (i === winnerIndex) {
      items.push({ key: `win-${winner.id}-${i}`, reward: winner, isWinner: true })
      continue
    }

    let picked = pickReward(pool, rng)
    if (pool.length > 1 && items[i - 1]?.reward.id === picked.id) {
      const others = pool.filter((item) => item.id !== picked.id)
      picked = pickReward(others, rng)
    }
    items.push({ key: `fill-${picked.id}-${i}`, reward: picked, isWinner: false })
  }

  return { items, winnerIndex }
}

export function resolveDailyFreeCaseReward(payload: {
  id: string
  name: string
  amount: number
  emoji?: string
}): DailyFreeCaseReward {
  const known = getDailyFreeCaseRewardById(payload.id)
  if (known) {
    return known
  }
  return {
    id: payload.id,
    name: payload.name,
    amount: payload.amount,
    weight: 0,
    emoji: payload.emoji || '⭐',
  }
}
