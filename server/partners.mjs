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
]

const ACCOUNT_LINK_REWARD = 1000

/** Stake / Welvura account IDs are numeric. */
const ACCOUNT_ID_PATTERN = /^[0-9]+$/

function formatRub(amount) {
  return new Intl.NumberFormat('ru-RU').format(amount)
}

function createPartnerTasks(partnerId, partnerName) {
  const accountLink = {
    id: `${partnerId}-task-1`,
    order: 1,
    type: 'account_link',
    title: `Привязать аккаунт ${partnerName}`,
    reward: ACCOUNT_LINK_REWARD,
    depositAmount: null,
  }

  const deposits = DEPOSIT_LADDER.map((item, index) => {
    const order = index + 2
    return {
      id: `${partnerId}-task-${order}`,
      order,
      type: 'deposit',
      title: `Депозит ${formatRub(item.amount)} ₽ в ${partnerName}`,
      reward: item.reward,
      depositAmount: item.amount,
    }
  })

  return [accountLink, ...deposits]
}

export const PARTNER_TASKS = {
  stake: {
    id: 'stake',
    name: 'Stake',
    accountIdPattern: ACCOUNT_ID_PATTERN,
    // Temporarily hidden from public partner list / banners.
    hidden: true,
    tasks: createPartnerTasks('stake', 'Stake'),
  },
  dragonmoney: {
    id: 'dragonmoney',
    name: 'Welvura',
    accountIdPattern: ACCOUNT_ID_PATTERN,
    tasks: createPartnerTasks('dragonmoney', 'Welvura'),
  },
}

export function listPartnersPublic() {
  return Object.values(PARTNER_TASKS)
    .filter((partner) => !partner.hidden)
    .map((partner) => ({
      id: partner.id,
      name: partner.name,
      tasks: partner.tasks.map((task) => ({
        id: task.id,
        order: task.order,
        type: task.type,
        title: task.title,
        reward: task.reward,
        depositAmount: task.depositAmount,
      })),
    }))
}

export function findPartner(partnerId) {
  return PARTNER_TASKS[partnerId] || null
}

export function findPartnerTask(taskId) {
  for (const partner of Object.values(PARTNER_TASKS)) {
    const index = partner.tasks.findIndex((task) => task.id === taskId)
    if (index >= 0) {
      return {
        partner,
        task: partner.tasks[index],
        index,
        previousTask: index > 0 ? partner.tasks[index - 1] : null,
      }
    }
  }

  return null
}

export function validatePartnerAccountId(partner, partnerAccountId) {
  const value = String(partnerAccountId || '').trim()
  if (!value) {
    return { ok: false, message: 'Укажи ID партнёрского аккаунта.' }
  }

  if (value.length > 32) {
    return { ok: false, message: 'ID аккаунта слишком длинный.' }
  }

  if (/[<>&"'`\\/]|script|javascript:/i.test(value)) {
    return { ok: false, message: 'Некорректный ID аккаунта.' }
  }

  const pattern = partner.accountIdPattern || ACCOUNT_ID_PATTERN
  if (!pattern.test(value)) {
    return { ok: false, message: 'ID аккаунта должен содержать только цифры.' }
  }

  return { ok: true, value }
}

export function rewardHistoryDescription(partner, task) {
  if (task.type === 'account_link') {
    return `Награда за задание ${partner.name}: привязка аккаунта`
  }

  if (task.depositAmount) {
    return `Награда за задание ${partner.name}: депозит ${formatRub(task.depositAmount)} ₽`
  }

  return `Награда за задание ${partner.name}`
}
