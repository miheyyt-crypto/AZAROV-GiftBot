import welvuraCookie from '@/assets/partners/welvura-cookie.png'
import stakeLogo from '@/assets/partners/stake-logo.png'
import type { PartnerConfig, PartnerTaskConfig } from '@/types/partner'

/** Bind-account reward (task 1). */
const ACCOUNT_LINK_REWARD = 1000

/**
 * Deposit ladder: amount ₽ → reward coins.
 * Exactly 13 deposits after account link = 14 tasks total.
 */
const DEPOSIT_LADDER = [
  { amount: 100, reward: 2_000 },
  { amount: 1_000, reward: 3_000 },
  { amount: 2_500, reward: 5_000 },
  { amount: 5_000, reward: 10_000 },
  { amount: 10_000, reward: 20_000 },
  { amount: 20_000, reward: 40_000 },
  { amount: 35_000, reward: 70_000 },
  { amount: 50_000, reward: 100_000 },
  { amount: 100_000, reward: 200_000 },
  { amount: 250_000, reward: 500_000 },
  { amount: 500_000, reward: 1_000_000 },
  { amount: 750_000, reward: 1_500_000 },
  { amount: 1_000_000, reward: 2_000_000 },
] as const

function formatRub(amount: number): string {
  return new Intl.NumberFormat('ru-RU').format(amount)
}

function depositDescription(amount: number): string {
  return (
    `Пополни счёт на ${formatRub(amount)} ₽ или больше и пришли скриншот вместе со своим ID. ` +
    `Депозиты засчитываются только после подтверждённой привязки аккаунта. ` +
    `Сначала пройди задание «Привяжи аккаунт», иначе депозит не увидим. ` +
    `Один депозит закрывает одно задание. Закрыть несколько заданий одним пополнением не получится.`
  )
}

function createPartnerTasks(
  partnerId: string,
  partnerName: string,
  actionUrl: string,
): PartnerTaskConfig[] {
  const accountLink: PartnerTaskConfig = {
    id: `${partnerId}-task-1`,
    order: 1,
    type: 'account_link',
    title: `Привязать аккаунт ${partnerName}`,
    description:
      `1. Зарегистрируйтесь в ${partnerName} по нашей ссылке.\n` +
      `2. После регистрации найдите свой ${partnerName} ID.\n` +
      `3. Введите ID и загрузите скриншот регистрации.\n` +
      `4. Отправьте заявку — администратор проверит вручную.`,
    reward: ACCOUNT_LINK_REWARD,
    actionUrl,
    actionLabel: 'ЗАРЕГИСТРИРОВАТЬСЯ',
    verificationType: 'account-link',
  }

  const deposits: PartnerTaskConfig[] = DEPOSIT_LADDER.map((item, index) => {
    const order = index + 2
    return {
      id: `${partnerId}-task-${order}`,
      order,
      type: 'deposit',
      title: `Депозит ${formatRub(item.amount)} ₽ в ${partnerName}`,
      description: depositDescription(item.amount),
      reward: item.reward,
      depositAmount: item.amount,
      actionUrl,
      actionLabel: `Открыть ${partnerName} >`,
      verificationType: 'deposit',
    }
  })

  return [accountLink, ...deposits]
}

export const partners: PartnerConfig[] = [
  {
    id: 'stake',
    name: 'Stake',
    logo: 'S',
    logoImage: stakeLogo,
    description: 'Привяжи аккаунт и выполняй',
    modalDescription:
      'Сначала привяжи аккаунт — после этого депозитные задания открываются по очереди. Следующее становится доступным только после выполнения предыдущего.',
    reward: ACCOUNT_LINK_REWARD,
    rewardSuffix: '+',
    theme: 'stake',
    image: stakeLogo,
    tasks: createPartnerTasks('stake', 'Stake', 'https://stake.com'),
    // Temporarily hidden from Tasks UI — keep config for easy re-enable.
    hidden: true,
  },
  {
    id: 'dragonmoney',
    name: 'Welvura',
    logo: 'WV',
    logoImage: welvuraCookie,
    description: 'Привяжи аккаунт и выполняй',
    modalDescription:
      'Сначала привяжи аккаунт — после этого депозитные задания открываются по очереди. Следующее становится доступным только после выполнения предыдущего.',
    reward: ACCOUNT_LINK_REWARD,
    rewardSuffix: '+',
    theme: 'dragonmoney',
    image: welvuraCookie,
    tasks: createPartnerTasks('dragonmoney', 'Welvura', 'https://welvar.link/?i=1485419'),
  },
]

export function getPartners(): PartnerConfig[] {
  return partners
    .filter((partner) => !partner.hidden)
    .map((partner) => ({
      ...partner,
      tasks: partner.tasks.map((task) => ({ ...task })),
    }))
}

export function getPartnerById(partnerId: string): PartnerConfig | null {
  return getPartners().find((partner) => partner.id === partnerId) ?? null
}
