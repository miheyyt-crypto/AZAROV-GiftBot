/**
 * Referral Battle contest — ranks users by Kick-active referrals.
 * Reuses store.referrals statuses (active|rewarded) from the existing referral system.
 */

import { isAdminTelegramUser } from './telegram-notify.mjs'
import { buildReferralLink, getReferralsByReferrer } from './users.mjs'
import { withStoreRead } from './store.mjs'

export const REFERRAL_CONTEST_ID = 'referral-battle-2026'

/** Prize ladder — must sum to 100_000. */
export const REFERRAL_CONTEST_PRIZES = [
  { place: 1, amount: 25_000 },
  { place: 2, amount: 17_000 },
  { place: 3, amount: 15_000 },
  { place: 4, amount: 11_000 },
  { place: 5, amount: 9_000 },
  { place: 6, amount: 7_000 },
  { place: 7, amount: 6_000 },
  { place: 8, amount: 4_000 },
  { place: 9, amount: 3_500 },
  { place: 10, amount: 2_500 },
]

export const REFERRAL_CONTEST_PRIZE_POOL = REFERRAL_CONTEST_PRIZES.reduce(
  (sum, row) => sum + row.amount,
  0,
)

function envFlag(name, defaultValue) {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') {
    return defaultValue
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase())
}

function envIso(name, fallback) {
  const raw = String(process.env[name] || '').trim()
  if (!raw) {
    return fallback
  }
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback
}

function displayName(user) {
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
  if (fullName) {
    return fullName
  }
  if (user?.username) {
    return user.username
  }
  return 'Игрок'
}

export function getReferralContestConfig() {
  const enabled = envFlag('REFERRAL_CONTEST_ENABLED', true)
  const adminOnly = envFlag('REFERRAL_CONTEST_ADMIN_ONLY', true)
  const startsAt = envIso('REFERRAL_CONTEST_START_AT', '2026-09-11T00:00:00.000Z')
  const endsAt = envIso('REFERRAL_CONTEST_END_AT', '2026-10-11T21:00:00.000Z')
  return {
    id: REFERRAL_CONTEST_ID,
    title: 'РЕФЕРАЛЬНЫЙ БАТТЛ',
    enabled,
    adminOnly,
    startsAt,
    endsAt,
    prizePool: REFERRAL_CONTEST_PRIZE_POOL,
    prizes: REFERRAL_CONTEST_PRIZES.map((row) => ({ ...row })),
  }
}

export function getReferralContestStatus(config = getReferralContestConfig(), nowMs = Date.now()) {
  if (!config.enabled) {
    return 'disabled'
  }
  const start = Date.parse(config.startsAt)
  const end = Date.parse(config.endsAt)
  if (Number.isFinite(start) && nowMs < start) {
    return 'scheduled'
  }
  if (Number.isFinite(end) && nowMs >= end) {
    return 'ended'
  }
  return 'active'
}

export function canAccessReferralContest(telegramUserId, config = getReferralContestConfig()) {
  if (!config.enabled) {
    return { ok: false, code: 'CONTEST_DISABLED', message: 'Конкурс сейчас недоступен.' }
  }
  if (config.adminOnly && !isAdminTelegramUser(telegramUserId)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Конкурс доступен только администраторам.' }
  }
  return { ok: true }
}

export function prizeForPlace(place) {
  const row = REFERRAL_CONTEST_PRIZES.find((item) => item.place === Number(place))
  return row ? row.amount : 0
}

function referralEventAt(referral) {
  return referral?.activatedAt || referral?.rewardedAt || referral?.createdAt || null
}

function isValidContestReferral(referral, config) {
  const status = String(referral?.status || '').toLowerCase()
  if (status !== 'active' && status !== 'rewarded') {
    return false
  }
  const at = referralEventAt(referral)
  if (!at) {
    return true
  }
  const ms = Date.parse(at)
  if (!Number.isFinite(ms)) {
    return true
  }
  const start = Date.parse(config.startsAt)
  const end = Date.parse(config.endsAt)
  if (Number.isFinite(start) && ms < start) {
    return false
  }
  if (Number.isFinite(end) && ms > end) {
    return false
  }
  return true
}

function inviteeKickLinked(store, referredUserId) {
  const key = String(referredUserId)
  if (store.kickByTelegram?.[key]) {
    return true
  }
  const user = store.users?.[key]
  return Boolean(user?.kickVerified && user?.kickUserId)
}

/**
 * Pure ranking builder for tests.
 * @returns {Array<{ telegramId: number, score: number, reachedAt: string|null, user: object }>}
 */
export function buildReferralContestRanking(store, config = getReferralContestConfig()) {
  const byReferrer = new Map()

  for (const referral of Object.values(store.referrals || {})) {
    const referrerId = Number(referral?.referrerUserId)
    if (!Number.isFinite(referrerId) || referrerId <= 0) {
      continue
    }
    if (!isValidContestReferral(referral, config)) {
      continue
    }
    const list = byReferrer.get(referrerId) || []
    list.push(referral)
    byReferrer.set(referrerId, list)
  }

  const ranked = []
  for (const [telegramId, refs] of byReferrer.entries()) {
    const user = store.users?.[String(telegramId)]
    if (!user) {
      continue
    }
    const sorted = [...refs].sort(
      (a, b) => Date.parse(referralEventAt(a) || 0) - Date.parse(referralEventAt(b) || 0),
    )
    const score = sorted.length
    if (score < 1) {
      continue
    }
    ranked.push({
      telegramId,
      user,
      score,
      reachedAt: referralEventAt(sorted[score - 1]),
    })
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    const aMs = Date.parse(a.reachedAt || '') || Number.MAX_SAFE_INTEGER
    const bMs = Date.parse(b.reachedAt || '') || Number.MAX_SAFE_INTEGER
    if (aMs !== bMs) {
      return aMs - bMs
    }
    return a.telegramId - b.telegramId
  })

  return ranked
}

function publicPlayer(row, rank, viewerId) {
  return {
    rank,
    username: row.user.username || '',
    displayName: displayName(row.user),
    photoUrl: row.user.photoUrl || '',
    score: row.score,
    prize: prizeForPlace(rank),
    isMe: viewerId != null && Number(row.telegramId) === Number(viewerId),
  }
}

function buildMyReferrals(store, viewerId) {
  const refs = getReferralsByReferrer(store, viewerId)
  return refs
    .map((referral) => {
      const invitee = store.users?.[String(referral.referredUserId)] || null
      const kickLinked =
        String(referral.status || '').toLowerCase() === 'active' ||
        String(referral.status || '').toLowerCase() === 'rewarded' ||
        inviteeKickLinked(store, referral.referredUserId)
      return {
        id: String(referral.id || `${referral.referrerUserId}:${referral.referredUserId}`),
        referredUserId: Number(referral.referredUserId),
        username: invitee?.username || '',
        displayName: displayName(invitee) || `ID ${referral.referredUserId}`,
        photoUrl: invitee?.photoUrl || '',
        kickLinked,
        kickUsername: invitee?.kickUsername || '',
        createdAt: referral.createdAt || null,
        activatedAt: referral.activatedAt || null,
        status: referral.status || 'pending',
      }
    })
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
}

function buildMotivation(meRank, meScore, ranking) {
  if (!meRank || meScore < 1) {
    return {
      kind: 'start',
      title: 'НАЧНИ УЧАСТВОВАТЬ',
      needed: 1,
      targetRank: null,
      targetScore: 1,
      nextPrize: prizeForPlace(10),
    }
  }

  if (meRank === 1) {
    const second = ranking[1] || null
    return {
      kind: 'leader',
      title: 'ТЫ ЛИДЕР',
      rivalRank: 2,
      rivalScore: second?.score ?? 0,
      leadBy: Math.max(0, meScore - (second?.score ?? 0)),
      prize: prizeForPlace(1),
    }
  }

  const above = ranking[meRank - 2] || null
  if (meRank <= 10) {
    const needed = above ? Math.max(1, above.score - meScore + 1) : 1
    return {
      kind: 'climb',
      title: 'ДО СЛЕДУЮЩЕГО МЕСТА',
      currentRank: meRank,
      targetRank: meRank - 1,
      targetScore: above?.score ?? meScore + 1,
      myScore: meScore,
      needed,
      currentPrize: prizeForPlace(meRank),
      nextPrize: prizeForPlace(meRank - 1),
    }
  }

  const tenth = ranking[9] || null
  const targetScore = tenth ? tenth.score : 1
  const needed = Math.max(1, targetScore - meScore + 1)
  return {
    kind: 'enter_top',
    title: 'ДО ПРИЗОВОГО МЕСТА',
    currentRank: meRank,
    targetRank: 10,
    targetScore,
    myScore: meScore,
    needed,
    nextPrize: prizeForPlace(10),
  }
}

export { buildMotivation }

export function getReferralContestSnapshot(viewerUserId) {
  const config = getReferralContestConfig()
  const access = canAccessReferralContest(viewerUserId, config)
  if (!access.ok) {
    return {
      success: false,
      code: access.code,
      message: access.message,
    }
  }

  return withStoreRead((store) => {
    const status = getReferralContestStatus(config)
    const ranking = buildReferralContestRanking(store, config)
    const players = ranking.map((row, index) => publicPlayer(row, index + 1, viewerUserId))
    const top3 = players.slice(0, 3)
    const top10 = players.slice(0, 10)

    const myIndex = ranking.findIndex((row) => Number(row.telegramId) === Number(viewerUserId))
    const myRow = myIndex >= 0 ? ranking[myIndex] : null
    const myScore = myRow?.score || 0
    const myRank = myIndex >= 0 ? myIndex + 1 : null

    const referrals = buildMyReferrals(store, viewerUserId)
    const kickLinkedCount = referrals.filter((item) => item.kickLinked).length
    const withoutKickCount = Math.max(0, referrals.length - kickLinkedCount)
    const contestKickCount = myScore
    const potentialPrize = myRank ? prizeForPlace(myRank) : 0

    const me = {
      rank: myRank,
      score: contestKickCount,
      invitedTotal: referrals.length,
      kickLinkedCount,
      withoutKickCount,
      potentialPrize,
      inTop10: Boolean(myRank && myRank <= 10),
      isLeader: myRank === 1,
      participating: contestKickCount > 0,
    }

    const viewer = store.users?.[String(viewerUserId)] || null

    return {
      success: true,
      contest: {
        ...config,
        status,
        prizes: config.prizes,
      },
      top3,
      top10,
      players: players.slice(0, 100),
      me,
      motivation: buildMotivation(myRank, contestKickCount, ranking),
      referrals,
      referralLink: viewer?.referralCode ? buildReferralLink(viewer.referralCode) : null,
      serverNow: new Date().toISOString(),
    }
  })
}

/** Session/home visibility — no contest payload, just whether UI may show entry points. */
export function getReferralContestVisibility(telegramUserId) {
  const config = getReferralContestConfig()
  const access = canAccessReferralContest(telegramUserId, config)
  return {
    enabled: config.enabled,
    adminOnly: config.adminOnly,
    visible: access.ok,
    status: getReferralContestStatus(config),
    endsAt: config.endsAt,
    startsAt: config.startsAt,
    prizePool: config.prizePool,
  }
}
