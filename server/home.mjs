import { buildUserLevelSnapshot } from './level.mjs'
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

function buildInviteCountMap(store) {
  const counts = new Map()
  for (const referral of Object.values(store.referrals || {})) {
    const referrerId = Number(referral?.referrerUserId)
    if (!Number.isFinite(referrerId) || referrerId <= 0) {
      continue
    }
    counts.set(referrerId, (counts.get(referrerId) || 0) + 1)
  }
  return counts
}

function normalizeMetric(metric) {
  return metric === 'referrals' ? 'referrals' : 'balance'
}

function normalizeLimit(limit, fallback = 3) {
  const raw = Math.floor(Number(limit))
  if (!Number.isFinite(raw) || raw < 1) {
    return fallback
  }
  return Math.min(100, raw)
}

function toPublicPlayer(row, rank, viewerId) {
  return {
    rank,
    username: row.user.username || '',
    displayName: displayName(row.user),
    photoUrl: row.user.photoUrl || '',
    balance: row.balance,
    invitedCount: row.invitedCount,
    level: row.level,
    isMe: viewerId != null && row.tid === viewerId,
  }
}

/**
 * @param {number} [limit=3]
 * @param {{ metric?: 'balance'|'referrals', viewerUserId?: number|null }} [options]
 */
export function getLeaderboard(limit = 3, options = {}) {
  const metric = normalizeMetric(options.metric)
  const capped = normalizeLimit(limit, 3)
  const viewerId =
    options.viewerUserId != null && Number.isFinite(Number(options.viewerUserId))
      ? Number(options.viewerUserId)
      : null

  return withStoreRead((store) => {
    const inviteCounts = buildInviteCountMap(store)
    const ranked = Object.values(store.users || {})
      .map((user) => {
        const tid = Number(user.telegramId)
        const balance = Math.max(0, Math.floor(Number(user.balance) || 0))
        const invitedCount = inviteCounts.get(tid) || 0
        const level = buildUserLevelSnapshot(user).level
        return { user, tid, balance, invitedCount, level }
      })
      .sort((a, b) => {
        if (metric === 'referrals') {
          if (b.invitedCount !== a.invitedCount) {
            return b.invitedCount - a.invitedCount
          }
          return b.balance - a.balance
        }
        if (b.balance !== a.balance) {
          return b.balance - a.balance
        }
        return b.invitedCount - a.invitedCount
      })

    const withScore = ranked.filter((row) =>
      metric === 'referrals' ? row.invitedCount > 0 : row.balance > 0,
    )

    const players = withScore
      .slice(0, capped)
      .map((row, index) => toPublicPlayer(row, index + 1, viewerId))

    let me = null
    if (viewerId != null) {
      const viewerRow = ranked.find((row) => row.tid === viewerId)
      if (viewerRow) {
        const fullRankIndex = ranked.findIndex((row) => row.tid === viewerId)
        const topIndex = withScore.findIndex((row) => row.tid === viewerId)
        me = {
          ...toPublicPlayer(viewerRow, fullRankIndex + 1, viewerId),
          inTop: topIndex >= 0 && topIndex < capped,
        }
      }
    }

    return { success: true, metric, players, me }
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
