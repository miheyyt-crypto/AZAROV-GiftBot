import type { LevelRewardGrant } from '@/lib/level-rewards'

const EVENT = 'azarov:level-up-celebration'

export interface LevelUpCelebrationDetail {
  rewards: LevelRewardGrant[]
  totalAmount: number
}

export function emitLevelUpCelebration(detail: LevelUpCelebrationDetail): void {
  if (typeof window === 'undefined') {
    return
  }
  if (!detail.rewards.length || detail.totalAmount <= 0) {
    return
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail }))
}

export function subscribeLevelUpCelebration(
  listener: (detail: LevelUpCelebrationDetail) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handler = (event: Event) => {
    const custom = event as CustomEvent<LevelUpCelebrationDetail>
    if (custom.detail?.rewards?.length) {
      listener(custom.detail)
    }
  }

  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
