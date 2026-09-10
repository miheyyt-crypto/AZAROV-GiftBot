/** Shared reward config for daily free case (server). Keep in sync with src/data/daily-free-case.ts */

export const DAILY_FREE_CASE_COOLDOWN_MS = 24 * 60 * 60 * 1000

/**
 * `chance` — display % in UI ("Что внутри").
 * `rollWeight` — real drop weight; sum = 1_000_000 (= 100%):
 *   legendary 0.0001% → 1
 *   epic      0.01%   → 100
 *   common    remainder → 999_899  (~99.9899%; "всё остальное")
 * Individual `weight` distributes within the category.
 */
export const DAILY_FREE_CASE_RARITY_ROLL_TOTAL = 1_000_000

export const DAILY_FREE_CASE_RARITIES = {
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
        valueLabel: '100 GRAM',
      },
      {
        id: 'dfc-gram-50',
        name: '50 Gram',
        rewardType: 'GRAM',
        amount: 50,
        weight: 1,
        emoji: '💠',
        valueLabel: '50 GRAM',
      },
      {
        id: 'dfc-durov-glass',
        name: "Durov's Glass",
        rewardType: 'ITEM',
        amount: 0,
        weight: 1,
        emoji: '🕶️',
        valueLabel: 'NFT',
      },
      {
        id: 'dfc-loot-bag',
        name: 'Loot Bag',
        rewardType: 'ITEM',
        amount: 0,
        weight: 1,
        emoji: '👜',
        valueLabel: 'NFT',
      },
      {
        id: 'dfc-diamond-ring',
        name: 'Diamond Ring',
        rewardType: 'ITEM',
        amount: 0,
        weight: 1,
        emoji: '💍',
        valueLabel: 'NFT',
      },
      {
        id: 'dfc-swiss-watch',
        name: 'Swiss Watch',
        rewardType: 'ITEM',
        amount: 0,
        weight: 1,
        emoji: '⌚',
        valueLabel: 'NFT',
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
        valueLabel: '2 GRAM',
      },
      {
        id: 'dfc-gram-1',
        name: '1 Gram',
        rewardType: 'GRAM',
        amount: 1,
        weight: 1,
        emoji: '💎',
        valueLabel: '1 GRAM',
      },
      {
        id: 'dfc-gram-0-5',
        name: '0.5 Gram',
        rewardType: 'GRAM',
        amount: 0.5,
        weight: 1,
        emoji: '💎',
        valueLabel: '0.5 GRAM',
      },
      {
        id: 'dfc-gram-0-2',
        name: '0.2 Gram',
        rewardType: 'GRAM',
        amount: 0.2,
        weight: 1,
        emoji: '💎',
        valueLabel: '0.2 GRAM',
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
        valueLabel: '0.01 GRAM',
      },
      {
        id: 'dfc-gram-0-005',
        name: '0.005 Gram',
        rewardType: 'GRAM',
        amount: 0.005,
        weight: 1,
        emoji: '🔹',
        valueLabel: '0.005 GRAM',
      },
      {
        id: 'dfc-gram-0-001',
        name: '0.001 Gram',
        rewardType: 'GRAM',
        amount: 0.001,
        weight: 1,
        emoji: '🔹',
        valueLabel: '0.001 GRAM',
      },
      {
        id: 'dfc-coins-100',
        name: '100 монет',
        rewardType: 'COINS',
        amount: 100,
        weight: 1,
        emoji: '🪙',
        valueLabel: '100 монет',
      },
      {
        id: 'dfc-coins-50',
        name: '50 монет',
        rewardType: 'COINS',
        amount: 50,
        weight: 1,
        emoji: '🪙',
        valueLabel: '50 монет',
      },
      {
        id: 'dfc-coins-25',
        name: '25 монет',
        rewardType: 'COINS',
        amount: 25,
        weight: 1,
        emoji: '🪙',
        valueLabel: '25 монет',
      },
    ],
  },
}

export const DAILY_FREE_CASE_RARITY_ORDER = ['legendary', 'epic', 'common']

export function listDailyFreeCaseRarities() {
  return DAILY_FREE_CASE_RARITY_ORDER.map((id) => DAILY_FREE_CASE_RARITIES[id])
}

export function getDailyFreeCaseRewardsFlat() {
  return listDailyFreeCaseRarities().flatMap((rarity) =>
    rarity.rewards.map((reward) => ({
      ...reward,
      rarity: rarity.id,
      rarityName: rarity.name,
      rarityChance: rarity.chance,
    })),
  )
}

/** @deprecated alias for flat list used by reel helpers */
export const DAILY_FREE_CASE_REWARDS = getDailyFreeCaseRewardsFlat()

export function getDailyFreeCaseRewardById(rewardId) {
  return getDailyFreeCaseRewardsFlat().find((item) => item.id === rewardId) || null
}

function pickWeighted(items, weightOf, rollValue) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0)
  if (total <= 0) {
    return items[items.length - 1] || null
  }
  let cursor = rollValue * total
  for (const item of items) {
    cursor -= weightOf(item)
    if (cursor <= 0) {
      return item
    }
  }
  return items[items.length - 1] || null
}

export function rollDailyFreeCaseReward(rng = Math.random) {
  const rarities = listDailyFreeCaseRarities()
  const rarity = pickWeighted(rarities, (item) => item.rollWeight, rng())
  if (!rarity?.rewards?.length) {
    return getDailyFreeCaseRewardsFlat()[0]
  }
  const reward = pickWeighted(rarity.rewards, (item) => item.weight, rng())
  return {
    ...reward,
    rarity: rarity.id,
    rarityName: rarity.name,
    rarityChance: rarity.chance,
  }
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
