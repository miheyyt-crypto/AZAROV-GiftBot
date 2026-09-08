import type { CaseOpening, CasePrize, CaseReward } from '@/types/case'

export const CASE_OPENING_DURATION_MS = 6_000
export const CASE_OPENING_REEL_LENGTH = 55
export const CASE_OPENING_WINNER_INDEX_MIN = 38
export const CASE_OPENING_WINNER_INDEX_MAX = 48
export const CASE_OPENING_RESULT_DELAY_MS = 450
export const CASE_OPENING_BOUNCE_PX = 6

export interface CaseReelItem {
  /** Unique key for React list (pool item may repeat). */
  key: string
  reward: CaseReward
  isWinner: boolean
}

export function randomIntInclusive(min: number, max: number, rng = Math.random): number {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return lo + Math.floor(rng() * (hi - lo + 1))
}

export function pickRandomPoolItem(
  pool: CaseReward[],
  rng = Math.random,
): CaseReward {
  if (!pool.length) {
    throw new Error('case_opening_empty_pool')
  }
  return pool[randomIntInclusive(0, pool.length - 1, rng)]!
}

/**
 * Resolve the visual reward card for a backend opening.
 * Does not change the prize — only attaches image metadata from the case pool.
 */
export function resolveWinnerReward(
  pool: CaseReward[],
  opening: CaseOpening,
): CaseReward {
  const byId =
    pool.find((item) => item.id === opening.rewardId) ||
    pool.find((item) => item.id === opening.prize.id)

  if (byId) {
    return byId
  }

  const prize: CasePrize = opening.prize
  const sameCurrency = pool.find((item) => item.currency === prize.currency)
  return {
    id: prize.id || opening.rewardId,
    name: prize.name,
    amount: prize.amount,
    currency: prize.currency,
    rarity: prize.rarity,
    chance: 0,
    image: sameCurrency?.image || '',
  }
}

export function buildCaseOpeningReel({
  pool,
  winner,
  length = CASE_OPENING_REEL_LENGTH,
  winnerIndex,
  rng = Math.random,
}: {
  pool: CaseReward[]
  winner: CaseReward
  length?: number
  winnerIndex?: number
  rng?: () => number
}): { items: CaseReelItem[]; winnerIndex: number } {
  const safeLength = Math.max(20, Math.floor(length))
  const minIdx = Math.min(CASE_OPENING_WINNER_INDEX_MIN, safeLength - 5)
  const maxIdx = Math.min(CASE_OPENING_WINNER_INDEX_MAX, safeLength - 3)
  const resolvedIndex =
    typeof winnerIndex === 'number' && Number.isFinite(winnerIndex)
      ? Math.max(2, Math.min(safeLength - 2, Math.floor(winnerIndex)))
      : randomIntInclusive(Math.max(2, minIdx), Math.max(2, maxIdx), rng)

  const source = pool.length > 0 ? pool : [winner]
  const items: CaseReelItem[] = []

  for (let i = 0; i < safeLength; i += 1) {
    if (i === resolvedIndex) {
      items.push({
        key: `winner-${winner.id}-${i}`,
        reward: winner,
        isWinner: true,
      })
      continue
    }

    let picked = pickRandomPoolItem(source, rng)
    // Avoid identical neighbor spam when pool has variety.
    if (source.length > 1 && items.length > 0 && picked.id === items[items.length - 1]?.reward.id) {
      picked = pickRandomPoolItem(
        source.filter((item) => item.id !== picked.id),
        rng,
      )
    }

    items.push({
      key: `fill-${picked.id}-${i}-${Math.floor(rng() * 1e9)}`,
      reward: picked,
      isWinner: false,
    })
  }

  return { items, winnerIndex: resolvedIndex }
}

/** Final track translateX so the winner card center aligns with the viewport center. */
export function computeReelTranslateX({
  containerWidth,
  itemWidth,
  gap,
  winnerIndex,
}: {
  containerWidth: number
  itemWidth: number
  gap: number
  winnerIndex: number
}): number {
  const stride = itemWidth + gap
  const winnerCenter = winnerIndex * stride + itemWidth / 2
  const containerCenter = containerWidth / 2
  return containerCenter - winnerCenter
}
