import { withStoreRead } from './store.mjs'

function displayName(user) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  if (fullName) {
    return fullName
  }

  if (user.username) {
    return user.username
  }

  return 'Игрок'
}

export function getLeaderboard(limit = 3) {
  return withStoreRead((store) => {
    const players = Object.values(store.users || {})
      .filter((user) => Number(user.balance) > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit)
      .map((user, index) => ({
        rank: index + 1,
        // Public payload: no raw telegramId (PII).
        username: user.username || '',
        displayName: displayName(user),
        photoUrl: user.photoUrl || '',
        balance: user.balance,
      }))

    return { success: true, players }
  })
}

export function getRecentCaseDrops(limit = 12) {
  return withStoreRead((store) => {
    const seen = new Set()
    const entries = []

    for (const user of Object.values(store.users || {})) {
      const openings = Array.isArray(user.caseOpenings) ? user.caseOpenings : []
      for (const opening of openings) {
        if (!opening?.openingId || seen.has(opening.openingId)) {
          continue
        }
        seen.add(opening.openingId)
        entries.push({ opening, user })
      }
    }

    for (const opening of Object.values(store.caseOpenings || {})) {
      if (!opening?.id && !opening?.openingId) {
        continue
      }

      const openingId = opening.openingId || opening.id
      if (seen.has(openingId)) {
        continue
      }

      const user = store.users[String(opening.userId)]
      if (!user) {
        continue
      }

      seen.add(openingId)
      entries.push({
        opening: {
          ...opening,
          openingId,
          prize: opening.prize || {
            name:
              opening.rewardCurrency === 'RUB'
                ? `${opening.rewardAmount} Рублей`
                : `${opening.rewardAmount} Монет`,
            rarity: opening.prize?.rarity || 'common',
          },
        },
        user,
      })
    }

    const drops = entries
      .sort(
        (a, b) =>
          new Date(b.opening.createdAt).getTime() - new Date(a.opening.createdAt).getTime(),
      )
      .slice(0, limit)
      .map(({ opening, user }) => ({
        id: opening.openingId,
        username: user.username || '',
        displayName: displayName(user),
        photoUrl: user.photoUrl || '',
        prizeName: opening.prize?.name || `${opening.rewardAmount}`,
        prizeAmount: opening.rewardAmount,
        prizeCurrency: opening.rewardCurrency,
        rarity: opening.prize?.rarity || 'common',
        createdAt: opening.createdAt,
      }))

    return { success: true, drops }
  })
}
