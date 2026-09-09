import { getReferralActivationReward, REFERRAL_CASE_EVERY } from './constants.mjs'
import { addCoins, hasEvent, sumTransactions, TX_TYPE } from './wallet.mjs'
import {
  buildReferralLink,
  countActiveReferrals,
  ensureUser,
  extractReferralCode,
  findUserByReferralCode,
  formatReferralCode,
  getReferralsByReferrer,
  hydrateUserReferrals,
  normalizeReferralCode,
  referralPairKey,
  resolveReferralStartParam,
} from './users.mjs'
import { withStore } from './store.mjs'
import { maybeGrantInviteFriendsTask } from './tasks.mjs'
import { grantPendingLevelRewardsOnStore } from './level-rewards.mjs'

export function migrateAllReferrals(store) {
  for (const user of Object.values(store.users || {})) {
    if (user?.telegramId) {
      hydrateUserReferrals(store, user)
    }
  }
}

function referralMessage(reason) {
  switch (reason) {
    case 'self_referral':
      return 'Нельзя пригласить самого себя.'
    case 'already_referred':
    case 'already_invited':
      return 'Приглашение уже сохранено.'
    case 'invalid_code':
      return 'Реферальная ссылка недействительна.'
    case 'applied':
      return 'Приглашение сохранено.'
    default:
      return ''
  }
}

function logReferral(event, details = {}) {
  // Never log tokens, hashes, cookies, or full initData.
  console.info(`[referral] ${event}`, details)
}

export { buildReferralLink } from './users.mjs'

function findReferralByReferredUser(store, referredUserId) {
  return (
    Object.values(store.referrals || {}).find(
      (item) => Number(item.referredUserId) === Number(referredUserId),
    ) || null
  )
}

function syncInvitedUser(referrer, referredUserId, status) {
  referrer.invitedUsers = referrer.invitedUsers || []
  const existing = referrer.invitedUsers.find((item) => item.telegramId === referredUserId)

  if (existing) {
    existing.status = status
    return
  }

  referrer.invitedUsers.push({
    telegramId: referredUserId,
    status,
    createdAt: new Date().toISOString(),
  })
}

export function getReferralCaseStats(activeCount, openedReferralCases) {
  const active = Math.max(0, Number(activeCount) || 0)
  const opened = Math.max(0, Number(openedReferralCases) || 0)
  const earnedReferralCases = Math.floor(active / REFERRAL_CASE_EVERY)
  const availableReferralCases = Math.max(0, earnedReferralCases - opened)
  let caseProgress = active % REFERRAL_CASE_EVERY
  if (availableReferralCases > 0 && caseProgress === 0) {
    caseProgress = REFERRAL_CASE_EVERY
  }

  return {
    caseProgress,
    caseTarget: REFERRAL_CASE_EVERY,
    availableReferralCases,
    earnedReferralCases,
    openedReferralCases: opened,
  }
}

/**
 * Bind invitee to referrer from signed start_param.
 * Does NOT grant coins — confirmation happens after Kick OAuth via activateReferralOnStore.
 */
export function processReferral(store, invitee, startParam) {
  store.referrals = store.referrals || {}

  const code = extractReferralCode(startParam)
  if (!code) {
    return { applied: false, reason: 'no_code', message: '' }
  }

  logReferral('referral_detected', {
    inviteeId: invitee.telegramId,
    codePrefix: code.slice(0, 2),
  })

  // First successful binding wins forever — never rebind to another referrer.
  const existingReferral = findReferralByReferredUser(store, invitee.telegramId)
  if (existingReferral || invitee.referredByUserId || invitee.referredBy) {
    if (existingReferral && !invitee.referredByUserId) {
      invitee.referredByUserId = existingReferral.referrerUserId
      invitee.referredBy = String(existingReferral.referrerUserId)
      invitee.referralStatus = invitee.referralStatus || existingReferral.status
      invitee.referralCreatedAt = invitee.referralCreatedAt || existingReferral.createdAt
    }

    return {
      applied: false,
      reason: 'already_referred',
      message: referralMessage('already_referred'),
    }
  }

  if (normalizeReferralCode(invitee.referralCode) === code) {
    logReferral('self_referral_prevented', { userId: invitee.telegramId })
    return {
      applied: false,
      reason: 'self_referral',
      message: referralMessage('self_referral'),
    }
  }

  const referrer = findUserByReferralCode(store, code)
  if (!referrer) {
    logReferral('invalid_referral_code', {
      inviteeId: invitee.telegramId,
      codePrefix: code.slice(0, 2),
    })
    return {
      applied: false,
      reason: 'invalid_code',
      message: referralMessage('invalid_code'),
    }
  }

  logReferral('referral_owner_found', {
    inviteeId: invitee.telegramId,
    referrerId: referrer.telegramId,
  })

  if (Number(referrer.telegramId) === Number(invitee.telegramId)) {
    logReferral('self_referral_prevented', { userId: invitee.telegramId })
    return {
      applied: false,
      reason: 'self_referral',
      message: referralMessage('self_referral'),
    }
  }

  const key = referralPairKey(referrer.telegramId, invitee.telegramId)
  const existing = store.referrals[key]

  if (existing) {
    invitee.referredByUserId = referrer.telegramId
    invitee.referredBy = String(referrer.telegramId)
    invitee.referralStatus = invitee.referralStatus || existing.status
    invitee.referralCreatedAt = invitee.referralCreatedAt || existing.createdAt
    return {
      applied: false,
      reason: 'already_invited',
      message: referralMessage('already_invited'),
    }
  }

  const createdAt = new Date().toISOString()
  store.referrals[key] = {
    id: key,
    referrerUserId: referrer.telegramId,
    referredUserId: invitee.telegramId,
    status: 'pending',
    createdAt,
    activatedAt: null,
    rewardedAt: null,
  }

  invitee.referredByUserId = referrer.telegramId
  invitee.referredBy = String(referrer.telegramId)
  invitee.referralStatus = 'pending'
  invitee.referralCreatedAt = createdAt
  invitee.referralRewardClaimed = false

  syncInvitedUser(referrer, invitee.telegramId, 'pending')

  logReferral('referral_created', {
    referrerId: referrer.telegramId,
    inviteeId: invitee.telegramId,
    referralId: key,
  })

  return {
    applied: true,
    reason: 'applied',
    message: referralMessage('applied'),
  }
}

function inviteeHasKickLinked(store, invitee) {
  if (!invitee) {
    return false
  }

  const tgKey = String(invitee.telegramId)
  if (store.kickByTelegram?.[tgKey]) {
    return true
  }

  return Boolean(invitee.kickVerified && invitee.kickUserId)
}

/**
 * Confirm referral and grant +REWARD once to BOTH referrer and invitee.
 * Requires the invitee's Kick account to be linked on the server.
 * Idempotent via wallet event ids + referral.status (file-locked withStore).
 */
export function activateReferralOnStore(store, userId) {
  const rewardAmount = getReferralActivationReward()
  const invitee = store.users[String(userId)]

  if (!invitee) {
    return {
      success: false,
      rewarded: false,
      reason: 'missing_user',
      message: 'Пользователь не найден.',
    }
  }

  const referral =
    findReferralByReferredUser(store, invitee.telegramId) ||
    (invitee.referredByUserId
      ? store.referrals[referralPairKey(invitee.referredByUserId, invitee.telegramId)]
      : null)

  if (!referral) {
    return {
      success: false,
      rewarded: false,
      reason: 'no_referrer',
      message: 'Реферал не найден.',
    }
  }

  const referrer = store.users[String(referral.referrerUserId)]
  if (!referrer || Number(referrer.telegramId) === Number(invitee.telegramId)) {
    return {
      success: false,
      rewarded: false,
      reason: 'no_referrer',
      message: 'Реферал не найден.',
    }
  }

  if (!inviteeHasKickLinked(store, invitee)) {
    logReferral('activation_waiting_for_kick', {
      referralId: referral.id,
      inviteeId: invitee.telegramId,
      referrerId: referrer.telegramId,
    })
    return {
      success: false,
      rewarded: false,
      reason: 'kick_required',
      message: 'Реферал подтвердится после привязки Kick.',
    }
  }

  const inviterEventId = `referral_reward:${referral.id}:inviter`
  const inviteeEventId = `referral_reward:${referral.id}:invitee`
  const alreadyRewarded =
    referral.status === 'rewarded' ||
    invitee.referralRewardClaimed ||
    invitee.invitedRewardGranted ||
    hasEvent(store, inviterEventId) ||
    hasEvent(store, inviteeEventId)

  if (alreadyRewarded) {
    logReferral('duplicate_reward_prevented', {
      referralId: referral.id,
      inviteeId: invitee.telegramId,
      referrerId: referrer.telegramId,
    })
    referral.status = 'rewarded'
    invitee.referralStatus = 'rewarded'
    invitee.referralRewardClaimed = true
    invitee.invitedRewardGranted = true
    syncInvitedUser(referrer, invitee.telegramId, 'rewarded')
    referrer.activeReferrals = countActiveReferrals(store, referrer.telegramId)
    return {
      success: true,
      rewarded: false,
      reason: 'already_granted',
      message: 'Награда уже получена.',
    }
  }

  const now = new Date().toISOString()
  referral.status = 'active'
  referral.activatedAt = referral.activatedAt || now
  invitee.referralStatus = 'active'
  invitee.referralActivatedAt = invitee.referralActivatedAt || now

  const inviterGrant = addCoins(
    store,
    referrer,
    rewardAmount,
    TX_TYPE.REFERRAL_REWARD,
    inviterEventId,
    {
      referenceId: referral.id,
      description: 'Награда за реферала (пригласивший)',
      referredUserId: invitee.telegramId,
    },
  )

  if (!inviterGrant.granted && inviterGrant.reason !== 'already_granted') {
    throw new Error('referral_reward_inviter_failed')
  }

  const inviteeGrant = addCoins(
    store,
    invitee,
    rewardAmount,
    TX_TYPE.REFERRAL_REWARD,
    inviteeEventId,
    {
      referenceId: referral.id,
      description: 'Награда за реферала (приглашённый)',
      referrerUserId: referrer.telegramId,
    },
  )

  if (!inviteeGrant.granted && inviteeGrant.reason !== 'already_granted') {
    throw new Error('referral_reward_invitee_failed')
  }

  if (!inviterGrant.granted && !inviteeGrant.granted) {
    logReferral('duplicate_reward_prevented', {
      referralId: referral.id,
      inviteeId: invitee.telegramId,
      referrerId: referrer.telegramId,
    })
    referral.status = 'rewarded'
    referral.rewardedAt = referral.rewardedAt || now
    invitee.referralStatus = 'rewarded'
    invitee.referralRewardClaimed = true
    invitee.invitedRewardGranted = true
    syncInvitedUser(referrer, invitee.telegramId, 'rewarded')
    referrer.activeReferrals = countActiveReferrals(store, referrer.telegramId)
    return {
      success: true,
      rewarded: false,
      reason: 'already_granted',
      message: 'Награда уже получена.',
    }
  }

  if (inviterGrant.granted) {
    referrer.referralEarnings += rewardAmount
  }

  referral.status = 'rewarded'
  referral.rewardedAt = now
  invitee.referralStatus = 'rewarded'
  invitee.referralRewardClaimed = true
  invitee.invitedRewardGranted = true
  syncInvitedUser(referrer, invitee.telegramId, 'rewarded')
  referrer.activeReferrals = countActiveReferrals(store, referrer.telegramId)

  maybeGrantInviteFriendsTask(store, referrer)

  logReferral('reward_granted', {
    referralId: referral.id,
    inviteeId: invitee.telegramId,
    referrerId: referrer.telegramId,
    amount: rewardAmount,
    inviterGranted: Boolean(inviterGrant.granted),
    inviteeGranted: Boolean(inviteeGrant.granted),
  })

  return {
    success: true,
    rewarded: Boolean(inviterGrant.granted || inviteeGrant.granted),
    reason: 'rewarded',
    message: `Реферал подтверждён. Начислено по ${rewardAmount} монет вам и пригласившему.`,
  }
}

/**
 * Bind from start_param (if any). Confirm + reward only if Kick is already linked.
 */
export function applyReferralAndReward(store, invitee, startParam) {
  const referral = processReferral(store, invitee, startParam)
  const activation = activateReferralOnStore(store, invitee.telegramId)
  return { referral, activation }
}

export function getReferralMe(store, user) {
  const referrals = getReferralsByReferrer(store, user.telegramId)
  const activeCount = referrals.filter(
    (item) => item.status === 'active' || item.status === 'rewarded',
  ).length
  const openedReferralCases = user.openedReferralCases || 0
  const caseStats = getReferralCaseStats(activeCount, openedReferralCases)
  const earnedCoins =
    sumTransactions(store, user.telegramId, TX_TYPE.REFERRAL_REWARD) || user.referralEarnings || 0

  return {
    referralCode: formatReferralCode(user.referralCode),
    referralLink: buildReferralLink(user.referralCode),
    invitedCount: referrals.length,
    activeCount,
    pendingCount: referrals.filter((item) => item.status === 'pending').length,
    earnedCoins,
    caseProgress: caseStats.caseProgress,
    caseTarget: caseStats.caseTarget,
    availableReferralCases: caseStats.availableReferralCases,
    earnedReferralCases: caseStats.earnedReferralCases,
    openedReferralCases: caseStats.openedReferralCases,
  }
}

export function bootstrapUser(telegramUser, startParam, options = {}) {
  return withStore((store) => {
    migrateAllReferrals(store)
    const user = ensureUser(store, telegramUser)
    const clientStartParam = String(options.clientStartParam || '').trim()
    const resolved = resolveReferralStartParam({
      signed: startParam,
      client: clientStartParam,
      pending: user.pendingStartParam,
    })

    if (resolved.value) {
      logReferral('start_param_received', {
        inviteeId: user.telegramId,
        source: resolved.source,
        codePrefix: extractReferralCode(resolved.value)?.slice(0, 2) || null,
      })
    }

    const { referral, activation } = applyReferralAndReward(store, user, resolved.value)

    if (user.pendingStartParam) {
      // Clear pending only after we attempted with a usable payload (or pending was consumed).
      if (resolved.value || resolved.source === 'pending') {
        user.pendingStartParam = null
      }
    }

    maybeGrantInviteFriendsTask(store, user)
    const levelRewards = grantPendingLevelRewardsOnStore(store, user)
    return { referral, activation, me: getReferralMe(store, user), levelRewards }
  })
}

/**
 * Bot /start handler helper.
 * Creates/updates the user and stores referral start payload for later Mini App bootstrap.
 * Does NOT apply referral rewards and does NOT call processReferral.
 */
export function registerBotStart(telegramUser, startPayload) {
  return withStore((store) => {
    migrateAllReferrals(store)
    const user = ensureUser(store, telegramUser)
    const payload = String(startPayload || '').trim()

    if (extractReferralCode(payload)) {
      user.pendingStartParam = payload
      console.info('[referral] bot_start_pending_saved', {
        telegramId: user.telegramId,
        codePrefix: extractReferralCode(payload)?.slice(0, 2) || null,
      })
    }

    return {
      telegramId: user.telegramId,
      firstName: user.firstName,
      pendingStartParam: user.pendingStartParam || null,
      referralCode: formatReferralCode(user.referralCode),
    }
  })
}

export function activateReferral(userId) {
  return withStore((store) => {
    migrateAllReferrals(store)
    return activateReferralOnStore(store, userId)
  })
}

export function readReferralMe(userId) {
  return withStore((store) => {
    migrateAllReferrals(store)
    const user = store.users[String(userId)]
    if (!user) {
      return { success: false, message: 'Пользователь не найден.' }
    }

    return {
      success: true,
      ...getReferralMe(store, user),
    }
  })
}
