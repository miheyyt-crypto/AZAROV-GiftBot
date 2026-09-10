import { withStoreRead } from './store.mjs'

// SAFETY LIMITS: prevent O(n) / O(n log n) scans from blocking the event loop
// when the store grows to thousands of users. These caps keep response times
// bounded even if caching below is disabled or expired.
const LEADERBOARD_MAX_USERS_SCANNED = 500
const RECENT_DROPS_MAX_USERS_SCANNED = 100

// Simple in-memory TTL caches. Leaderboard changes infrequently, recent drops
// change more often but still benefit from a short cache window under load.
const LEADERBOARD_CACHE_TTL_MS = 8000
const RECENT_DROPS_CACHE_TTL_MS = 3000

let leaderboardCache = { key: null, timestamp: 0, result: null }
let recentDropsCache = { key: null, timestamp: 0, result: null }

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
  const now = Date.now()
  if (
    leaderboardCache.result &&
    leaderboardCache.key === limit &&
    now - leaderboardCache.timestamp < LEADERBOARD_CACHE_TTL_MS
  ) {
    return leaderboardCache.result
  }

  const __start = Date.now()
  const result = withStoreRead((store) => {
    const allUsers = Object.values(store.users || {})
    // SAFETY CHECK: never scan the entire user base, cap at a fixed amount.
    const usersToScan = allUsers.slice(0, LEADERBOARD_MAX_USERS_SCANNED)

    const players = usersToScan
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

    console.log(
      `[PERF] getLeaderboard: scanned ${usersToScan.length}/${allUsers.length} users, took ${
        Date.now() - __start
      }ms`,
    )

    return { success: true, players }
  })

  leaderboardCache = { key: limit, timestamp: now, result }
  return result
}

export function getRecentCaseDrops(limit = 12) {
  const now = Date.now()
  if (
    recentDropsCache.result &&
    recentDropsCache.key === limit &&
    now - recentDropsCache.timestamp < RECENT_DROPS_CACHE_TTL_MS
  ) {
    return recentDropsCache.result
  }

  const __start = Date.now()
  const result = withStoreRead((store) => {
    const seen = new Set()
    const entries = []

    // Process the flat store.caseOpenings collection first. This avoids the
    // O(n^2) cost of iterating every user's embedded case-opening history
    // just to find the most recent global drops.
    const allCaseOpenings = Object.values(store.caseOpenings || {})
    let caseOpeningsScanned = 0

    for (const opening of allCaseOpenings) {
      if (!opening?.id && !opening?.openingId) {
        continue
      }

      const openingId = opening.openingId || opening.id
      if (seen.has(openingId)) {
        continue
      }

      const user = store.users?.[String(opening.userId)]
      if (!user) {
        continue
      }

      seen.add(openingId)
      caseOpeningsScanned += 1
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

    entries.sort(
      (a, b) =>
        new Date(b.opening.createdAt).getTime() - new Date(a.opening.createdAt).getTime(),
    )

    let usersScanned = 0

    // Only fall back to scanning per-user history when store.caseOpenings
    // did not yield enough recent entries. SAFETY CHECK: cap the number of
    // users scanned instead of iterating the entire user base (which can be
    // in the thousands).
    if (entries.length < limit) {
      const allUsers = Object.values(store.users || {})
      const usersToScan = allUsers.slice(0, RECENT_DROPS_MAX_USERS_SCANNED)
      usersScanned = usersToScan.length

      for (const user of usersToScan) {
        const openings = Array.isArray(user.caseOpenings) ? user.caseOpenings : []
        for (const opening of openings) {
          if (!opening?.openingId || seen.has(opening.openingId)) {
            continue
          }
          seen.add(opening.openingId)
          entries.push({ opening, user })
        }
      }

      entries.sort(
        (a, b) =>
          new Date(b.opening.createdAt).getTime() - new Date(a.opening.createdAt).getTime(),
      )
    }

    const drops = entries.slice(0, limit).map(({ opening, user }) => ({
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

    console.log(
      `[PERF] getRecentCaseDrops: scanned ${caseOpeningsScanned} case openings, ${usersScanned} users, took ${
        Date.now() - __start
      }ms`,
    )

    return { success: true, drops }
  })

  recentDropsCache = { key: limit, timestamp: now, result }
  return result
}
