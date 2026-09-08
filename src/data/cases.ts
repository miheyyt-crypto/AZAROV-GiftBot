import coinsImage from '@/assets/cases/reward-coins.svg'
import rubImage from '@/assets/cases/reward-rub.svg'
import mediumImage from '@/assets/cases/medium.svg'
import poorImage from '@/assets/cases/poor.svg'
import referralImage from '@/assets/cases/referral.png'
import richImage from '@/assets/cases/rich.svg'
import dropTables from '@/data/case-drops.json'
import type { CaseReward, CaseRewardCurrency, GiftCase } from '@/types/case'

function rewardImage(currency: CaseRewardCurrency): string {
  return currency === 'RUB' ? rubImage : coinsImage
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
    image: rewardImage(reward.currency),
  }))
}

export function getRewardChanceTotal(rewards: Array<{ chance: number }>): number {
  return rewards.reduce((sum, reward) => sum + reward.chance, 0)
}

export function isDropTableValid(rewards: Array<{ chance: number }>): boolean {
  return getRewardChanceTotal(rewards) === 100
}

/**
 * Medium case drop currently sums to 101%:
 * 2 + 2 + 10 + 11 + 28 + 48 = 101
 *
 * Do not change silently. After confirmation, edit one chance in
 * `src/data/case-drops.json` — most likely `medium-coins-8888.chance`.
 */
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
