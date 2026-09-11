import { buildUserLevelSnapshot } from './level.mjs'
import { withStoreRead } from './store.mjs'
import { TX_TYPE } from './wallet.mjs'

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

function formatCoinsLabel(amount) {
  const value = Math.max(0, Math.floor(Number(amount) || 0))
  return `${value.toLocaleString('ru-RU')} монет`
}

function formatMultiplierLabel(payout, bet) {
  const stake = Number(bet) || 0
  const win = Number(payout) || 0
  if (stake <= 0 || win <= 0) {
    return null
  }
  return `х${(win / stake).toFixed(2)}`
}

function formatChanceLabel(bet, total) {
  const b = Number(bet) || 0
  const t = Number(total) || 0
  if (t <= 0 || b <= 0) {
    return null
  }
  const pct = Math.round((b / t) * 10000) / 100
  const shown = Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 10) / 10)
  return `шанс ${shown}%`
}

function parseMultiplierFromDescription(description) {
  const match = String(description || '').match(/[×xх]\s*([\d.]+)/i)
  if (!match) {
    return null
  }
  return `х${match[1]}`
}

function parseChanceFromDescription(description) {
  const match = String(description || '').match(/шанс\s+([\d.]+)\s*%/i)
  if (!match) {
    return null
  }
  return `шанс ${match[1]}%`
}


function chanceLabelFromStoredCard(card, roundId) {
  if (!card || String(card.roundId || '') !== String(roundId || '')) {
    return null
  }
  const chance = Number(card.winnerChance)
  if (!Number.isFinite(chance) || chance <= 0) {
    return null
  }
  const shown = Number.isInteger(chance) ? String(chance) : String(Math.round(chance * 10) / 10)
  return `шанс ${shown}%`
}

function buildActiveReferralCountMap(store) {
  const counts = new Map()
  for (const referral of Object.values(store.referrals || {})) {
    const status = String(referral?.status || '').toLowerCase()
    if (status !== 'active' && status !== 'rewarded') {
      continue
    }
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
    const inviteCounts = buildActiveReferralCountMap(store)
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

function collectCaseDropEntries(store) {
  const seen = new Set()
  const entries = []

  for (const user of Object.values(store.users || {})) {
    const openings = Array.isArray(user.caseOpenings) ? user.caseOpenings : []
    for (const opening of openings) {
      if (!opening?.openingId || seen.has(opening.openingId)) {
        continue
      }
      seen.add(opening.openingId)
      entries.push({
        sortAt: opening.createdAt,
        drop: {
          id: opening.openingId,
          kind: 'case',
          username: user.username || '',
          displayName: displayName(user),
          photoUrl: user.photoUrl || '',
          prizeName: opening.prize?.name || `${opening.rewardAmount}`,
          prizeAmount: opening.rewardAmount,
          prizeCurrency: opening.rewardCurrency || 'COINS',
          rarity: opening.prize?.rarity || 'common',
          createdAt: opening.createdAt,
        },
      })
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
    const prize = opening.prize || {
      name:
        opening.rewardCurrency === 'RUB'
          ? `${opening.rewardAmount} Рублей`
          : `${opening.rewardAmount} Монет`,
      rarity: 'common',
    }
    entries.push({
      sortAt: opening.createdAt,
      drop: {
        id: openingId,
        kind: 'case',
        username: user.username || '',
        displayName: displayName(user),
        photoUrl: user.photoUrl || '',
        prizeName: prize.name || `${opening.rewardAmount}`,
        prizeAmount: opening.rewardAmount,
        prizeCurrency: opening.rewardCurrency || 'COINS',
        rarity: prize.rarity || 'common',
        createdAt: opening.createdAt,
      },
    })
  }

  return entries
}

function collectGameWinEntries(store) {
  const entries = []
  const seenTx = new Set()

  for (const tx of Object.values(store.coinTransactions || {})) {
    if (!tx?.id || seenTx.has(tx.id)) {
      continue
    }
    seenTx.add(tx.id)

    const type = String(tx.type || '')
    const amount = Math.floor(Number(tx.amount) || 0)
    if (amount < 1) {
      continue
    }

    const user = store.users[String(tx.userId)]
    if (!user) {
      continue
    }

    if (type === TX_TYPE.MINES_WIN) {
      const game = store.minesGames?.[String(tx.referenceId || '')]
      const metaLabel =
        formatMultiplierLabel(game?.payout ?? amount, game?.bet) ||
        parseMultiplierFromDescription(tx.description)
      entries.push({
        sortAt: tx.createdAt,
        drop: {
          id: `mines:${tx.id}`,
          kind: 'mines',
          username: user.username || '',
          displayName: displayName(user),
          photoUrl: user.photoUrl || '',
          title: 'Выиграл в mines',
          prizeName: formatCoinsLabel(amount),
          prizeAmount: amount,
          prizeCurrency: 'COINS',
          metaLabel: metaLabel || undefined,
          createdAt: tx.createdAt,
        },
      })
      continue
    }

    if (type === TX_TYPE.ROLL_WIN) {
      const roundId = String(tx.referenceId || '')
      const round = store.rollRounds?.[roundId]
      const winnerId = Number(tx.userId)
      const winner = (round?.players || []).find((p) => Number(p.userId) === winnerId)
      const pot = (round?.players || []).reduce((sum, p) => sum + (Number(p.bet) || 0), 0)
      const metaLabel =
        formatChanceLabel(winner?.bet, pot || round?.pot) ||
        chanceLabelFromStoredCard(store.rollMeta?.previousGame, roundId) ||
        chanceLabelFromStoredCard(store.rollMeta?.topGame, roundId) ||
        parseChanceFromDescription(tx.description)

      entries.push({
        sortAt: tx.createdAt,
        drop: {
          id: `roll:${tx.id}`,
          kind: 'roll',
          username: user.username || '',
          displayName: displayName(user),
          photoUrl: user.photoUrl || '',
          title: 'Выиграл в roll',
          prizeName: formatCoinsLabel(amount),
          prizeAmount: amount,
          prizeCurrency: 'COINS',
          metaLabel: metaLabel || undefined,
          createdAt: tx.createdAt,
        },
      })
    }
  }

  return entries
}

export function getRecentCaseDrops(limit = 12) {
  return withStoreRead((store) => {
    const capped = Math.min(40, Math.max(1, Math.floor(Number(limit) || 12)))
    const entries = [...collectCaseDropEntries(store), ...collectGameWinEntries(store)]
    const drops = entries
      .sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime())
      .slice(0, capped)
      .map((entry) => entry.drop)

    return { success: true, drops }
  })
}
