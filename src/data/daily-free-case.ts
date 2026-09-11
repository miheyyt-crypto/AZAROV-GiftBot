import coinImage from '@/assets/cases/reward-coins.webp'
import diamondRingImage from '@/assets/cases/reward-diamond-ring.webp'
import durovGlassImage from '@/assets/cases/reward-durov-glass.webp'
import gramImage from '@/assets/cases/reward-gram.webp'
import lootBagImage from '@/assets/cases/reward-loot-bag.webp'
import swissWatchImage from '@/assets/cases/reward-swiss-watch.webp'

export type DailyFreeCaseRarityId = 'legendary' | 'epic' | 'common'
export type DailyFreeCaseRewardType = 'GRAM' | 'COINS' | 'ITEM'

export interface DailyFreeCaseReward {
  id: string
  name: string
  rewardType: DailyFreeCaseRewardType
  amount: number
  weight: number
  emoji: string
  valueLabel: string
  /** Optional image; emoji used when absent. */
  image?: string
  rarity?: DailyFreeCaseRarityId
  rarityName?: string
  rarityChance?: number
}

export interface DailyFreeCaseRarityConfig {
  id: DailyFreeCaseRarityId
  name: string
  /** Display % in "Что внутри" UI (not the real drop rate). */
  chance: number
  /**
   * Real roll weight. Sum across rarities = 1_000_000 (= 100%):
   * legendary 0.0001% → 1, epic 0.01% → 100, common remainder → 999_899.
   */
  rollWeight: number
  rewards: DailyFreeCaseReward[]
}

/** Keep in sync with server/daily-free-case-config.mjs */
export const DAILY_FREE_CASE_COOLDOWN_MS = 24 * 60 * 60 * 1000

export const DAILY_FREE_CASE_RARITIES: Record<DailyFreeCaseRarityId, DailyFreeCaseRarityConfig> = {
  legendary: {
    id: 'legendary',
    name: 'Легендарный',
    chance: 1,
    rollWeight: 1,
    rewards: [
      {
        id: 'dfc-gram-100',
        name: '100 Gram',
        rewardType: 'GRAM',
        amount: 100,
        weight: 1,
        emoji: '💠',
        valueLabel: '100 Gram',
        image: gramImage,
      },
      {
        id: 'dfc-gram-50',
        name: '50 Gram',
        rewardType: 'GRAM',
        amount: 50,
        weight: 1,
        emoji: '💠',
        valueLabel: '50 Gram',
        image: gramImage,
      },
      {
        id: 'dfc-durov-glass',
        name: "Durov's Glass",
        rewardType: 'ITEM',
        amount: 0,
        weight: 1,
        emoji: '🕶️',
        valueLabel: 'NFT',
        image: durovGlassImage,
      },
      {
        id: 'dfc-loot-bag',
        name: 'Loot Bag',
        rewardType: 'ITEM',
        amount: 0,
        weight: 1,
        emoji: '👜',
        valueLabel: 'NFT',
        image: lootBagImage,
      },
      {
        id: 'dfc-diamond-ring',
        name: 'Diamond Ring',
        rewardType: 'ITEM',
        amount: 0,
        weight: 1,
        emoji: '💍',
        valueLabel: 'NFT',
        image: diamondRingImage,
      },
      {
        id: 'dfc-swiss-watch',
        name: 'Swiss Watch',
        rewardType: 'ITEM',
        amount: 0,
        weight: 1,
        emoji: '⌚',
        valueLabel: 'NFT',
        image: swissWatchImage,
      },
    ],
  },
  epic: {
    id: 'epic',
    name: 'Эпический',
    chance: 15,
    rollWeight: 100,
    rewards: [
      {
        id: 'dfc-gram-2',
        name: '2 Gram',
        rewardType: 'GRAM',
        amount: 2,
        weight: 1,
        emoji: '💎',
        valueLabel: '2 Gram',
        image: gramImage,
      },
      {
        id: 'dfc-gram-1',
        name: '1 Gram',
        rewardType: 'GRAM',
        amount: 1,
        weight: 1,
        emoji: '💎',
        valueLabel: '1 Gram',
        image: gramImage,
      },
      {
        id: 'dfc-gram-0-5',
        name: '0.5 Gram',
        rewardType: 'GRAM',
        amount: 0.5,
        weight: 1,
        emoji: '💎',
        valueLabel: '0.5 Gram',
        image: gramImage,
      },
      {
        id: 'dfc-gram-0-2',
        name: '0.2 Gram',
        rewardType: 'GRAM',
        amount: 0.2,
        weight: 1,
        emoji: '💎',
        valueLabel: '0.2 Gram',
        image: gramImage,
      },
    ],
  },
  common: {
    id: 'common',
    name: 'Обычный',
    chance: 50,
    rollWeight: 999_899,
    rewards: [
      {
        id: 'dfc-gram-0-01',
        name: '0.01 Gram',
        rewardType: 'GRAM',
        amount: 0.01,
        weight: 1,
        emoji: '🔹',
        valueLabel: '0.01 Gram',
        image: gramImage,
      },
      {
        id: 'dfc-gram-0-005',
        name: '0.005 Gram',
        rewardType: 'GRAM',
        amount: 0.005,
        weight: 1,
        emoji: '🔹',
        valueLabel: '0.005 Gram',
        image: gramImage,
      },
      {
        id: 'dfc-gram-0-001',
        name: '0.001 Gram',
        rewardType: 'GRAM',
        amount: 0.001,
        weight: 1,
        emoji: '🔹',
        valueLabel: '0.001 Gram',
        image: gramImage,
      },
      {
        id: 'dfc-coins-100',
        name: '100 монет',
        rewardType: 'COINS',
        amount: 100,
        weight: 1,
        emoji: '🪙',
        valueLabel: '100 монет',
        image: coinImage,
      },
      {
        id: 'dfc-coins-50',
        name: '50 монет',
        rewardType: 'COINS',
        amount: 50,
        weight: 1,
        emoji: '🪙',
        valueLabel: '50 монет',
        image: coinImage,
      },
      {
        id: 'dfc-coins-25',
        name: '25 монет',
        rewardType: 'COINS',
        amount: 25,
        weight: 1,
        emoji: '🪙',
        valueLabel: '25 монет',
        image: coinImage,
      },
    ],
  },
}

export const DAILY_FREE_CASE_RARITY_ORDER: DailyFreeCaseRarityId[] = [
  'legendary',
  'epic',
  'common',
]

export function listDailyFreeCaseRarities(): DailyFreeCaseRarityConfig[] {
  return DAILY_FREE_CASE_RARITY_ORDER.map((id) => DAILY_FREE_CASE_RARITIES[id])
}

export function getDailyFreeCaseRewardsFlat(): DailyFreeCaseReward[] {
  return listDailyFreeCaseRarities().flatMap((rarity) =>
    rarity.rewards.map((reward) => ({
      ...reward,
      rarity: rarity.id,
      rarityName: rarity.name,
      rarityChance: rarity.chance,
    })),
  )
}

/** Flat pool for spin reel — same source as contents modal. */
export const DAILY_FREE_CASE_REWARDS = getDailyFreeCaseRewardsFlat()

export function getDailyFreeCaseRewardById(id: string): DailyFreeCaseReward | null {
  return getDailyFreeCaseRewardsFlat().find((item) => item.id === id) ?? null
}

export function formatGiftCountLabel(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} подарок`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} подарка`
  }
  return `${count} подарков`
}

export function formatEachChanceLabel(rarityChance: number, count: number): string {
  if (count <= 0) {
    return '0%'
  }
  const each = rarityChance / count
  const text = Number.isInteger(each) ? String(each) : each.toFixed(2).replace(/\.?0+$/, '')
  return `${text}%`
}
