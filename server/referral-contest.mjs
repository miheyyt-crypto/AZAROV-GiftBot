/**
 * Referral Battle contest — ranks users by Kick-active referrals.
 * Reuses store.referrals statuses (active|rewarded) from the existing referral system.
 * Auto-finalizes after END_AT (giveaway-style scheduler) with idempotent coin payouts.
 */

import {
  createNotificationOnStore,
  NOTIFICATION_TYPE,
} from './notifications.mjs'
import { isAdminTelegramUser, sendTelegramMessage } from './telegram-notify.mjs'
import { withStore, withStoreRead } from './store.mjs'
import { buildReferralLink, getReferralsByReferrer } from './users.mjs'
import { addCoins, hasEvent, TX_TYPE, utcNow } from './wallet.mjs'

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

/** Default 24h window for this launch (UTC). Override via env or store bootstrap. */
export const REFERRAL_CONTEST_DEFAULT_START_AT = '2026-09-11T12:55:00.000Z'
export const REFERRAL_CONTEST_DEFAULT_END_AT = '2026-09-12T12:55:00.000Z'

const DEFAULT_SCHEDULER_MS = 30_000
const DAY_MS = 24 * 60 * 60 * 1000

let schedulerStarted = false
let schedulerTimer = null

function envFlag(name, defaultValue) {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') {
    return defaultValue
  }
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase())
}

function envIso(name) {
  const raw = String(process.env[name] || '').trim()
  if (!raw) {
    return null
  }
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function logContest(event, payload = {}) {
  console.info(`[REFERRAL_CONTEST] ${event}`, payload)
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

export function ensureReferralContestMaps(store) {
  store.referralContests = store.referralContests || {}
  store.events = store.events || {}
  store.coinTransactions = store.coinTransactions || {}
  store.notifications = store.notifications || {}
}

export function contestRewardEventId(contestId, place, userId) {
  return `referral_contest:${contestId}:place:${place}:user:${userId}`
}

export function contestNotifyEventKey(contestId, place, userId) {
  return `referral_contest_notify:${contestId}:place:${place}:user:${userId}`
}

export function assertPrizePoolValid() {
  const sum = REFERRAL_CONTEST_PRIZES.reduce((acc, row) => acc + row.amount, 0)
  if (sum !== 100_000 || REFERRAL_CONTEST_PRIZE_POOL !== 100_000) {
    throw new Error(`invalid_referral_contest_prize_pool:${sum}`)
  }
}

/**
 * Resolve contest window: env → store record → code defaults.
 * When `persist` and store has no window, writes active contest schedule.
 */
export function resolveReferralContestWindow(store = null, { nowMs = Date.now(), persist = false } = {}) {
  const envStart = envIso('REFERRAL_CONTEST_START_AT')
  const envEnd = envIso('REFERRAL_CONTEST_END_AT')
  const row = store?.referralContests?.[REFERRAL_CONTEST_ID] || null

  let startsAt = envStart || row?.startsAt || REFERRAL_CONTEST_DEFAULT_START_AT
  let endsAt = envEnd || row?.endsAt || REFERRAL_CONTEST_DEFAULT_END_AT

  if (!envStart && !envEnd && !row?.startsAt && persist && store) {
    startsAt = new Date(nowMs).toISOString()
    endsAt = new Date(nowMs + DAY_MS).toISOString()
  } else if (envStart && !envEnd) {
    endsAt = new Date(Date.parse(startsAt) + DAY_MS).toISOString()
  } else if (!envStart && envEnd && row?.startsAt) {
    startsAt = row.startsAt
  }

  if (persist && store) {
    ensureReferralContestMaps(store)
    const existing = store.referralContests[REFERRAL_CONTEST_ID]
    if (!existing) {
      store.referralContests[REFERRAL_CONTEST_ID] = {
        id: REFERRAL_CONTEST_ID,
        status: 'active',
        title: 'РЕФЕРАЛЬНЫЙ БАТТЛ',
        startsAt,
        endsAt,
        prizePool: REFERRAL_CONTEST_PRIZE_POOL,
        results: [],
        ranking: [],
        finalizedAt: null,
        createdAt: new Date(nowMs).toISOString(),
      }
    } else if (existing.status !== 'finished') {
      if (envStart) existing.startsAt = startsAt
      if (envEnd || envStart) existing.endsAt = endsAt
      if (!existing.startsAt) existing.startsAt = startsAt
      if (!existing.endsAt) existing.endsAt = endsAt
    } else {
      startsAt = existing.startsAt || startsAt
      endsAt = existing.endsAt || endsAt
    }
  }

  return { startsAt, endsAt }
}

export function getReferralContestConfig(store = null) {
  const enabled = envFlag('REFERRAL_CONTEST_ENABLED', true)
  const adminOnly = envFlag('REFERRAL_CONTEST_ADMIN_ONLY', false)
  const window = resolveReferralContestWindow(store, { persist: false })
  const row = store?.referralContests?.[REFERRAL_CONTEST_ID] || null
  return {
    id: REFERRAL_CONTEST_ID,
    title: row?.title || 'РЕФЕРАЛЬНЫЙ БАТТЛ',
    enabled,
    adminOnly,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    prizePool: REFERRAL_CONTEST_PRIZE_POOL,
    prizes: REFERRAL_CONTEST_PRIZES.map((item) => ({ ...item })),
    storeStatus: row?.status || null,
    finalizedAt: row?.finalizedAt || null,
  }
}

export function getReferralContestStatus(config = getReferralContestConfig(), nowMs = Date.now()) {
  if (!config.enabled) {
    return 'disabled'
  }
  if (config.storeStatus === 'finished' || config.finalizedAt) {
    return 'ended'
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

/** Kick-link timestamp only — invite createdAt must not inflate contest score. */
function referralEventAt(referral) {
  return referral?.activatedAt || referral?.rewardedAt || null
}

function isValidContestReferral(referral, config) {
  const status = String(referral?.status || '').toLowerCase()
  if (status !== 'active' && status !== 'rewarded') {
    return false
  }
  const at = referralEventAt(referral)
  if (!at) {
    return false
  }
  const ms = Date.parse(at)
  if (!Number.isFinite(ms)) {
    return false
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
 * Pure ranking builder for tests / live / finalize.
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
    username: row.user?.username || row.username || '',
    displayName: row.user ? displayName(row.user) : row.displayName || 'Игрок',
    photoUrl: row.user?.photoUrl || row.photoUrl || '',
    score: row.score,
    prize: prizeForPlace(rank),
    isMe: viewerId != null && Number(row.telegramId) === Number(viewerId),
    telegramId: Number(row.telegramId),
  }
}

function frozenPlayer(row, viewerId) {
  return {
    rank: row.place || row.rank,
    username: row.username || '',
    displayName: row.displayName || 'Игрок',
    photoUrl: row.photoUrl || '',
    score: row.score,
    prize: row.prizeAmount ?? prizeForPlace(row.place || row.rank),
    isMe: viewerId != null && Number(row.userId || row.telegramId) === Number(viewerId),
    telegramId: Number(row.userId || row.telegramId),
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

function medalLabel(place) {
  if (place === 1) return '🥇 1 место'
  if (place === 2) return '🥈 2 место'
  if (place === 3) return '🥉 3 место'
  return `#${place} место`
}

export function buildWinnerTelegramText({ place, score, prizeAmount }) {
  const amount = Number(prizeAmount || 0).toLocaleString('ru-RU')
  if (place === 1) {
    return [
      '👑 <b>ТЫ ПОБЕДИТЕЛЬ!</b>',
      '',
      'Ты занял 1 место в РЕФЕРАЛЬНОМ БАТТЛЕ.',
      '',
      `🏆 <b>${amount} 🪙</b> уже начислены на твой баланс.`,
    ].join('\n')
  }
  if (place === 2) {
    return [
      '🥈 <b>ТЫ ЗАНЯЛ 2 МЕСТО!</b>',
      '',
      'Поздравляем!',
      '',
      '🎁 Твой приз:',
      `<b>${amount} 🪙</b>`,
      '',
      'Приз уже начислен на твой баланс.',
    ].join('\n')
  }
  if (place === 3) {
    return [
      '🥉 <b>ТЫ ЗАНЯЛ 3 МЕСТО!</b>',
      '',
      'Поздравляем!',
      '',
      '🎁 Твой приз:',
      `<b>${amount} 🪙</b>`,
      '',
      'Приз уже начислен на твой баланс.',
    ].join('\n')
  }
  return [
    '🏆 <b>ТЫ В ПРИЗОВОЙ ДЕСЯТКЕ!</b>',
    '',
    `Твоё место: #${place}`,
    '',
    `Твой результат: ${score} реф. с Kick`,
    '',
    '🎁 Твой приз:',
    `<b>${amount} 🪙</b>`,
    '',
    'Приз уже начислен.',
  ].join('\n')
}

function buildWinnerInAppMessage({ place, score, prizeAmount }) {
  const amount = Number(prizeAmount || 0).toLocaleString('ru-RU')
  return [
    '🏆 КОНКУРС ЗАВЕРШЁН!',
    '',
    'Поздравляем! 🎉',
    '',
    `Ты занял: ${medalLabel(place)}`,
    '',
    `Твой результат: ${score} рефералов с привязанным Kick`,
    '',
    `🎁 Твой приз: ${amount} 🪙`,
    '',
    'Приз уже начислен на твой баланс.',
  ].join('\n')
}

function payContestWinnerOnStore(store, contest, resultRow) {
  const userId = Number(resultRow.userId)
  const place = Number(resultRow.place)
  const amount = Number(resultRow.prizeAmount) || 0
  const eventId = contestRewardEventId(contest.id, place, userId)
  const user = store.users?.[String(userId)]
  let coinsGranted = false

  if (user && amount > 0) {
    const credit = addCoins(store, user, amount, TX_TYPE.CONTEST_REWARD, eventId, {
      referenceId: `${contest.id}:place:${place}`,
      description: `Приз за ${place} место в РЕФЕРАЛЬНОМ БАТТЛЕ`,
      contestId: contest.id,
      place,
    })
    coinsGranted = Boolean(credit.granted) || credit.reason === 'already_granted'
  } else if (hasEvent(store, eventId)) {
    coinsGranted = true
  }

  if (coinsGranted) {
    resultRow.prizeStatus = 'paid'
    resultRow.paidAt = resultRow.paidAt || utcNow()
    resultRow.eventId = eventId
  } else {
    resultRow.prizeStatus = 'failed'
  }

  const notifyKey = contestNotifyEventKey(contest.id, place, userId)
  const notification = createNotificationOnStore(store, {
    userId,
    type: NOTIFICATION_TYPE.CONTEST_WON,
    title: place === 1 ? '👑 Ты победитель!' : '🏆 Приз за реферальный баттл',
    message: buildWinnerInAppMessage({
      place,
      score: resultRow.score,
      prizeAmount: amount,
    }),
    eventKey: notifyKey,
    relatedEntityType: 'referral_contest',
    relatedEntityId: contest.id,
    metadata: {
      contestId: contest.id,
      place,
      prizeAmount: amount,
      score: resultRow.score,
    },
  })

  if (notification.created || notification.reason === 'already_exists' || hasEvent(store, `notification:${notifyKey}`)) {
    resultRow.notificationQueued = true
  }

  return {
    userId,
    place,
    amount,
    coinsGranted,
    telegramText: buildWinnerTelegramText({
      place,
      score: resultRow.score,
      prizeAmount: amount,
    }),
  }
}

/**
 * Finalize contest after END_AT. Idempotent under withStore lock.
 */
export function finalizeReferralContestOnStore(store, { nowIso = utcNow(), force = false } = {}) {
  ensureReferralContestMaps(store)
  assertPrizePoolValid()

  const nowMs = Date.parse(nowIso)
  resolveReferralContestWindow(store, { nowMs, persist: true })
  const config = getReferralContestConfig(store)

  if (!config.enabled && !force) {
    return { success: false, code: 'DISABLED', telegramJobs: [], alreadyFinalized: false }
  }

  const endMs = Date.parse(config.endsAt)
  if (!force && (!Number.isFinite(endMs) || nowMs < endMs)) {
    return { success: false, code: 'NOT_DUE', telegramJobs: [], alreadyFinalized: false }
  }

  let contest = store.referralContests[REFERRAL_CONTEST_ID]
  if (!contest) {
    contest = {
      id: REFERRAL_CONTEST_ID,
      status: 'active',
      title: config.title,
      startsAt: config.startsAt,
      endsAt: config.endsAt,
      prizePool: REFERRAL_CONTEST_PRIZE_POOL,
      results: [],
      ranking: [],
      finalizedAt: null,
      createdAt: nowIso,
    }
    store.referralContests[REFERRAL_CONTEST_ID] = contest
  }

  const telegramJobs = []

  if (contest.status === 'finished' && Array.isArray(contest.results) && contest.results.length >= 0) {
    logContest('Resume payouts for finished contest', { contestId: contest.id })
    for (const row of contest.results) {
      if (row.prizeStatus === 'paid' && row.notificationQueued) {
        continue
      }
      const rewarded = payContestWinnerOnStore(store, contest, row)
      logContest(`Paid ${rewarded.amount} to user ${rewarded.userId}`, {
        place: rewarded.place,
        granted: rewarded.coinsGranted,
      })
      if (rewarded.coinsGranted) {
        telegramJobs.push({
          kind: 'winner',
          userId: rewarded.userId,
          place: rewarded.place,
          text: rewarded.telegramText,
          resultKey: `${contest.id}:${rewarded.place}:${rewarded.userId}`,
        })
      }
    }
    return {
      success: true,
      alreadyFinalized: true,
      contest,
      telegramJobs,
    }
  }

  logContest('Starting finalization', { contestId: REFERRAL_CONTEST_ID, endsAt: config.endsAt })

  // Atomic claim under file lock: mark finished before payouts so concurrent ticks no-op create.
  const ranking = buildReferralContestRanking(store, config)
  logContest('Final leaderboard calculated', { players: ranking.length })

  const frozenRanking = ranking.map((row, index) => ({
    place: index + 1,
    userId: Number(row.telegramId),
    username: row.user?.username || '',
    displayName: displayName(row.user),
    photoUrl: row.user?.photoUrl || '',
    score: row.score,
    reachedAt: row.reachedAt || null,
    prizeAmount: prizeForPlace(index + 1),
  }))

  const results = frozenRanking.slice(0, 10).map((row) => ({
    ...row,
    prizeStatus: 'pending',
    notificationQueued: false,
    notificationSent: false,
    paidAt: null,
    eventId: contestRewardEventId(contest.id, row.place, row.userId),
    createdAt: nowIso,
  }))

  const winnersPrizeSum = results.reduce((sum, row) => sum + (Number(row.prizeAmount) || 0), 0)
  // Only full ladder amounts for occupied places — validate configured ladder, not partial occupancy.
  assertPrizePoolValid()
  if (winnersPrizeSum > REFERRAL_CONTEST_PRIZE_POOL) {
    throw new Error(`contest_payout_overflow:${winnersPrizeSum}`)
  }

  contest.status = 'finished'
  contest.finalizedAt = nowIso
  contest.startsAt = config.startsAt
  contest.endsAt = config.endsAt
  contest.prizePool = REFERRAL_CONTEST_PRIZE_POOL
  contest.title = config.title
  contest.ranking = frozenRanking
  contest.results = results

  logContest('Winners', { count: results.length })
  logContest('Prize payout started')

  for (const row of results) {
    const rewarded = payContestWinnerOnStore(store, contest, row)
    logContest(`Paid ${rewarded.amount} to user ${rewarded.userId}`, {
      place: rewarded.place,
      granted: rewarded.coinsGranted,
    })
    if (rewarded.coinsGranted) {
      telegramJobs.push({
        kind: 'winner',
        userId: rewarded.userId,
        place: rewarded.place,
        text: rewarded.telegramText,
        resultKey: `${contest.id}:${rewarded.place}:${rewarded.userId}`,
      })
    }
  }

  logContest('Notifications queued', { jobs: telegramJobs.length })
  logContest('Contest finalized successfully', { contestId: contest.id })

  return {
    success: true,
    alreadyFinalized: false,
    contest,
    telegramJobs,
  }
}

export function finalizeReferralContestIfDue(options = {}) {
  return withStore((store) => finalizeReferralContestOnStore(store, options))
}

export async function notifyReferralContestTelegramJobs(jobs = [], options = {}) {
  for (const job of jobs) {
    if (!job?.text || !job?.userId) {
      continue
    }
    try {
      const result = await sendTelegramMessage(String(job.userId), job.text, { parse_mode: 'HTML' }, options)
      if (!result?.ok) {
        logContest('Notification failed', {
          userId: job.userId,
          error: result?.error || 'unknown',
        })
        continue
      }
      if (job.resultKey) {
        withStore((store) => {
          const contest = store.referralContests?.[REFERRAL_CONTEST_ID]
          const row = contest?.results?.find(
            (item) => `${contest.id}:${item.place}:${item.userId}` === job.resultKey,
          )
          if (row) {
            row.notificationSent = true
          }
        })
      }
    } catch (error) {
      logContest('Notification failed', {
        userId: job.userId,
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }
}

export function bootstrapReferralContestSchedule() {
  return withStore((store) => {
    const window = resolveReferralContestWindow(store, { persist: true })
    const row = store.referralContests[REFERRAL_CONTEST_ID]
    logContest('Schedule ready', {
      contestId: REFERRAL_CONTEST_ID,
      status: row?.status || 'active',
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      adminOnly: envFlag('REFERRAL_CONTEST_ADMIN_ONLY', false),
      enabled: envFlag('REFERRAL_CONTEST_ENABLED', true),
    })
    return { startsAt: window.startsAt, endsAt: window.endsAt, status: row?.status || 'active' }
  })
}

export function startReferralContestScheduler({ intervalMs = DEFAULT_SCHEDULER_MS } = {}) {
  if (schedulerStarted) {
    return { started: false, alreadyRunning: true }
  }
  schedulerStarted = true

  try {
    bootstrapReferralContestSchedule()
  } catch (error) {
    logContest('Bootstrap failed', {
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }

  const tick = () => {
    try {
      const result = finalizeReferralContestIfDue()
      if (result?.telegramJobs?.length) {
        void notifyReferralContestTelegramJobs(result.telegramJobs)
      }
    } catch (error) {
      logContest('Scheduler error', {
        error: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  tick()
  schedulerTimer = setInterval(tick, intervalMs)
  if (typeof schedulerTimer.unref === 'function') {
    schedulerTimer.unref()
  }
  logContest('Scheduler started', { intervalMs })
  return { started: true, alreadyRunning: false }
}

export function stopReferralContestScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }
  schedulerStarted = false
}

export function getReferralContestSnapshot(viewerUserId) {
  const accessConfig = getReferralContestConfig()
  const access = canAccessReferralContest(viewerUserId, accessConfig)
  if (!access.ok) {
    return {
      success: false,
      code: access.code,
      message: access.message,
    }
  }

  return withStoreRead((store) => {
    const config = getReferralContestConfig(store)
    const status = getReferralContestStatus(config)
    const contestRow = store.referralContests?.[REFERRAL_CONTEST_ID] || null
    const frozen = contestRow?.status === 'finished' && Array.isArray(contestRow.ranking)

    let players
    if (frozen) {
      players = contestRow.ranking.map((row) => frozenPlayer(row, viewerUserId))
    } else {
      const ranking = buildReferralContestRanking(store, config)
      players = ranking.map((row, index) => publicPlayer(row, index + 1, viewerUserId))
    }

    const top3 = players.slice(0, 3)
    const top10 = players.slice(0, 10)

    const myIndex = players.findIndex((row) => Number(row.telegramId) === Number(viewerUserId))
    const myRow = myIndex >= 0 ? players[myIndex] : null
    const myScore = myRow?.score || 0
    const myRank = myIndex >= 0 ? myIndex + 1 : null

    const referrals = buildMyReferrals(store, viewerUserId)
    const kickLinkedCount = referrals.filter((item) => item.kickLinked).length
    const withoutKickCount = Math.max(0, referrals.length - kickLinkedCount)
    const resultRow = contestRow?.results?.find((item) => Number(item.userId) === Number(viewerUserId))
    const potentialPrize = frozen
      ? Number(resultRow?.prizeAmount) || (myRank ? prizeForPlace(myRank) : 0)
      : myRank
        ? prizeForPlace(myRank)
        : 0

    const me = {
      rank: myRank,
      score: myScore,
      invitedTotal: referrals.length,
      kickLinkedCount,
      withoutKickCount,
      potentialPrize,
      prizeAwarded: Number(resultRow?.prizeAmount) || 0,
      prizeStatus: resultRow?.prizeStatus || null,
      inTop10: Boolean(myRank && myRank <= 10),
      isLeader: myRank === 1,
      participating: myScore > 0 || Boolean(resultRow),
    }

    const viewer = store.users?.[String(viewerUserId)] || null
    const liveRanking = frozen ? null : buildReferralContestRanking(store, config)

    return {
      success: true,
      contest: {
        ...config,
        status,
        prizes: config.prizes,
        finalizedAt: contestRow?.finalizedAt || null,
      },
      top3,
      top10,
      players: players.slice(0, 100),
      winners: frozen
        ? (contestRow.results || []).map((row) => frozenPlayer(row, viewerUserId))
        : top10,
      me,
      motivation: frozen
        ? { kind: 'start', title: 'КОНКУРС ЗАВЕРШЁН' }
        : buildMotivation(myRank, myScore, liveRanking || []),
      referrals,
      referralLink: viewer?.referralCode ? buildReferralLink(viewer.referralCode) : null,
      serverNow: new Date().toISOString(),
    }
  })
}

/** Session/home visibility — no contest payload, just whether UI may show entry points. */
export function getReferralContestVisibility(telegramUserId) {
  return withStoreRead((store) => {
    const config = getReferralContestConfig(store)
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
  })
}
