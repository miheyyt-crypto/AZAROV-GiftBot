import coinsImage from '@/assets/cases/reward-coins.png'
import rub1000Image from '@/assets/cases/reward-rub-1000.png'
import rub5000Image from '@/assets/cases/reward-rub-5000.png'
import rubOtherImage from '@/assets/cases/reward-rub-other.png'
import mediumImage from '@/assets/cases/medium.jpg'
import poorImage from '@/assets/cases/poor.jpg'
import referralImage from '@/assets/cases/referral.png'
import richImage from '@/assets/cases/rich.jpg'
import dropTables from '@/data/case-drops.json'
import type { CaseReward, CaseRewardCurrency, GiftCase } from '@/types/case'

/** Cash prize art by denomination; coins keep the shared coin asset. */
export function rewardImageForPrize(currency: CaseRewardCurrency, amount: number): string {
  if (currency !== 'RUB') {
    return coinsImage
  }
  const rub = Math.floor(Number(amount) || 0)
  if (rub === 1000 || rub === 2000 || rub === 3000) {
    return rub1000Image
  }
  if (rub === 5000) {
    return rub5000Image
  }
  return rubOtherImage
}

/** @deprecated Prefer rewardImageForPrize(currency, amount). */
export function rewardImageForCurrency(currency: CaseRewardCurrency): string {
  return rewardImageForPrize(currency, 0)
}

function attachRewardImages(
  rewards: Array<{
    id: string
    name: string
    amount: number
    currency: CaseRewardCurrency
    rarity: CaseReward['rarity']
    chance: number
  }>,
): CaseReward[] {
  return rewards.map((reward) => ({
    ...reward,
    image: rewardImageForPrize(reward.currency, reward.amount),
  }))
}

export function getRewardChanceTotal(rewards: Array<{ chance: number }>): number {
  return rewards.reduce((sum, reward) => sum + reward.chance, 0)
}

export function isDropTableValid(rewards: Array<{ chance: number }>): boolean {
  return getRewardChanceTotal(rewards) === 100
}

export const cases: GiftCase[] = [
  {
    id: 'poor',
    name: 'Нищий кейс',
    description: 'Самый доступный. Заходит каждому.',
    image: poorImage,
    maxPrize: 'до 5 000 ₽',
    price: 8999,
    type: 'purchase',
    borderClass: 'border-emerald-400/70 shadow-[0_0_22px_rgb(52_211_153/28%)]',
    rewards: attachRewardImages(dropTables.poor as CaseReward[]),
  },
  {
    id: 'medium',
    name: 'Средний кейс',
    description: 'Больше наград. Больше шансов на крупный выигрыш.',
    image: mediumImage,
    maxPrize: 'до 10 000 ₽',
    price: 22222,
    type: 'purchase',
    borderClass: 'border-sky-400/70 shadow-[0_0_22px_rgb(56_189_248/28%)]',
    rewards: attachRewardImages(dropTables.medium as CaseReward[]),
  },
  {
    id: 'rich',
    name: 'Блатной кейс',
    description: 'Для тех, кто готов к большим ставкам.',
    image: richImage,
    maxPrize: 'до 30 000 ₽',
    price: 64999,
    type: 'purchase',
    borderClass: 'border-fuchsia-400/70 shadow-[0_0_22px_rgb(232_121_249/28%)]',
    rewards: attachRewardImages(dropTables.rich as CaseReward[]),
  },
  {
    id: 'referral',
    name: 'Реферальный кейс',
    description: 'Выдаётся за каждые 5 приглашённых друзей.',
    image: referralImage,
    subtitle: 'Падает за активность',
    type: 'referral',
    borderClass: 'border-[#b56bff]/75 shadow-[0_0_22px_rgb(181_107_255/30%)]',
    rewards: attachRewardImages(dropTables.referral as CaseReward[]),
  },
]

export function getCases(): GiftCase[] {
  return cases.map((item) => ({
    ...item,
    rewards: item.rewards.map((reward) => ({ ...reward })),
  }))
}

export function getCaseById(caseId: string): GiftCase | null {
  return getCases().find((item) => item.id === caseId) ?? null
}
