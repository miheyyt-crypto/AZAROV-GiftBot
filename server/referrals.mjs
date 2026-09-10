import { getReferralActivationReward, REFERRAL_CASE_EVERY } from './constants.mjs'
import {
  blockUserMultiAccount,
  emptyReferralMe,
  enforceAntiAbuseOnStore,
  peekRegistrationSignals,
  userCanUseAppEconomy,
} from './anti-abuse.mjs'
import { addCoins, hasEvent, sumTransactions, TX_TYPE } from './wallet.mjs'
import {
  buildReferralLink,
  countActiveReferrals,
  createUser,
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

  const economy = userCanUseAppEconomy(invitee)
  if (!economy.ok) {
    return {
      applied: false,
      reason: economy.code === 'MULTI_ACCOUNT_BLOCKED' ? 'blocked' : 'registration_incomplete',
      message: economy.message || '',
    }
  }

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

  const inviteeGate = userCanUseAppEconomy(invitee)
  if (!inviteeGate.ok) {
    return {
      success: false,
      rewarded: false,
      reason: inviteeGate.code === 'MULTI_ACCOUNT_BLOCKED' ? 'blocked' : 'registration_incomplete',
      message: inviteeGate.message || 'Реферал недоступен.',
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
  if (invitee?.blocked || !invitee?.antiAbuseBound) {
    return {
      referral: {
        applied: false,
        reason: invitee?.blocked ? 'blocked' : 'registration_incomplete',
        message: invitee?.blocked
          ? 'Аккаунт заблокирован'
          : 'Завершите вход в приложение.',
      },
      activation: {
        rewarded: false,
        reason: invitee?.blocked ? 'blocked' : 'registration_incomplete',
      },
    }
  }
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
    // When true, skip rewriting store.json if nothing durable changed (warm Mini App session).
    const trackDirty = options.skipUnchangedPersist === true
    const beforeSnap = trackDirty ? JSON.stringify(store) : null

    store.pendingBotStarts = store.pendingBotStarts || {}

    const telegramId = Number(telegramUser.id)
    let user = store.users[String(telegramId)] || null
    const isNew = !user

    const finish = (payload) => {
      if (!trackDirty) {
        return payload
      }
      const dirty = JSON.stringify(store) !== beforeSnap
      return { ...payload, __storeDirty: dirty, storePersisted: dirty }
    }

    // NEW telegram: never create a durable economic user before anti-abuse ALLOW.
    if (isNew) {
      if (!options.enforceAntiAbuse) {
        return finish({
          referral: { applied: false, reason: 'registration_incomplete' },
          activation: { rewarded: false, reason: 'registration_incomplete' },
          me: emptyReferralMe(),
          levelRewards: { granted: [], totalAmount: 0, level: 0 },
          antiAbuse: {
            allowed: false,
            code: 'REGISTRATION_INCOMPLETE',
            message: 'Завершите вход в приложение.',
          },
          blocked: false,
          created: false,
          user: null,
        })
      }

      const peek = peekRegistrationSignals(store, {
        deviceId: options.deviceId,
        ip: options.ip,
      })

      if (!peek.ok && peek.code === 'MULTI_ACCOUNT_BLOCKED') {
      user = createUser(store, telegramUser, { unbound: true })
        blockUserMultiAccount(store, user, {
          deviceId: peek.deviceId,
          ipHash: peek.ipHash,
          deviceUsed: peek.deviceUsed,
          ipUsed: peek.ipUsed,
        })
        return finish({
          referral: { applied: false, reason: 'blocked' },
          activation: { rewarded: false, reason: 'blocked' },
          me: getReferralMe(store, user),
          levelRewards: { granted: [], totalAmount: 0, level: 0 },
          antiAbuse: {
            allowed: false,
            code: 'MULTI_ACCOUNT_BLOCKED',
            message: 'Аккаунт заблокирован',
            deviceUsed: peek.deviceUsed,
            ipUsed: peek.ipUsed,
          },
          blocked: true,
          created: true,
          user,
        })
      }

      if (!peek.ok) {
        return finish({
          referral: { applied: false, reason: 'registration_incomplete' },
          activation: { rewarded: false, reason: 'registration_incomplete' },
          me: emptyReferralMe(),
          levelRewards: { granted: [], totalAmount: 0, level: 0 },
          antiAbuse: {
            allowed: false,
            code: peek.code,
            message: peek.message,
          },
          blocked: false,
          created: false,
          user: null,
        })
      }

      user = createUser(store, telegramUser, { unbound: true })
      const bound = enforceAntiAbuseOnStore(store, user, {
        deviceId: options.deviceId,
        ip: options.ip,
      })
      if (!bound.allowed) {
        return finish({
          referral: { applied: false, reason: 'blocked' },
          activation: { rewarded: false, reason: 'blocked' },
          me: getReferralMe(store, user),
          levelRewards: { granted: [], totalAmount: 0, level: 0 },
          antiAbuse: bound,
          blocked: Boolean(user.blocked),
          created: true,
          user,
        })
      }
    } else {
      user = ensureUser(store, telegramUser)
    }

    // Legacy invitedUsers → referrals for THIS user only (never scan all users on session).
    // ensureUser already hydrates; call again only for freshly created users.
    if (isNew) {
      hydrateUserReferrals(store, user)
    }

    if (user.blocked) {
      return finish({
        referral: { applied: false, reason: 'blocked' },
        activation: { rewarded: false, reason: 'blocked' },
        me: getReferralMe(store, user),
        levelRewards: { granted: [], totalAmount: 0, level: 0 },
        antiAbuse: {
          allowed: false,
          code: 'MULTI_ACCOUNT_BLOCKED',
          message: 'Аккаунт заблокирован',
        },
        blocked: true,
        created: false,
        user,
      })
    }

    let antiAbuse = { allowed: true, code: null, message: null }

    if (!user.antiAbuseBound) {
      if (!options.enforceAntiAbuse) {
        return finish({
          referral: { applied: false, reason: 'registration_incomplete' },
          activation: { rewarded: false, reason: 'registration_incomplete' },
          me: getReferralMe(store, user),
          levelRewards: { granted: [], totalAmount: 0, level: 0 },
          antiAbuse: {
            allowed: false,
            code: 'REGISTRATION_INCOMPLETE',
            message: 'Завершите вход в приложение.',
          },
          blocked: false,
          created: false,
          user,
        })
      }
      antiAbuse = enforceAntiAbuseOnStore(store, user, {
        deviceId: options.deviceId,
        ip: options.ip,
      })
      if (!antiAbuse.allowed) {
        return finish({
          referral: {
            applied: false,
            reason:
              antiAbuse.code === 'MULTI_ACCOUNT_BLOCKED' ? 'blocked' : 'registration_incomplete',
          },
          activation: {
            rewarded: false,
            reason:
              antiAbuse.code === 'MULTI_ACCOUNT_BLOCKED' ? 'blocked' : 'registration_incomplete',
          },
          me: getReferralMe(store, user),
          levelRewards: { granted: [], totalAmount: 0, level: 0 },
          antiAbuse,
          blocked: Boolean(user.blocked),
          created: false,
          user,
        })
      }
    } else if (options.deviceId || options.ip) {
      // Existing / grandfathered: allow login; seed free IP/device indexes.
      antiAbuse = enforceAntiAbuseOnStore(store, user, {
        deviceId: options.deviceId,
        ip: options.ip,
      })
      if (!antiAbuse.allowed) {
        return finish({
          referral: { applied: false, reason: 'blocked' },
          activation: { rewarded: false, reason: 'blocked' },
          me: getReferralMe(store, user),
          levelRewards: { granted: [], totalAmount: 0, level: 0 },
          antiAbuse,
          blocked: true,
          created: false,
          user,
        })
      }
    }

    const pendingBot = store.pendingBotStarts[String(telegramId)]
    if (pendingBot?.payload && !user.pendingStartParam) {
      user.pendingStartParam = String(pendingBot.payload)
    }
    if (store.pendingBotStarts[String(telegramId)]) {
      delete store.pendingBotStarts[String(telegramId)]
    }

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
      if (resolved.value || resolved.source === 'pending') {
        user.pendingStartParam = null
      }
    }

    maybeGrantInviteFriendsTask(store, user)
    const levelRewards = grantPendingLevelRewardsOnStore(store, user)
    return finish({
      referral,
      activation,
      me: getReferralMe(store, user),
      levelRewards,
      antiAbuse,
      blocked: Boolean(user.blocked),
      created: isNew,
      user,
    })
  })
}

/**
 * Bot /start: do NOT create a durable user for first-time visitors.
 * Only stash referral payload until Mini App / web session passes anti-abuse.
 */
export function registerBotStart(telegramUser, startPayload) {
  return withStore((store) => {
    migrateAllReferrals(store)
    store.pendingBotStarts = store.pendingBotStarts || {}
    const payload = String(startPayload || '').trim()
    const existing = store.users[String(telegramUser.id)]

    if (existing) {
      const user = ensureUser(store, telegramUser)
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
        created: false,
      }
    }

    if (extractReferralCode(payload)) {
      store.pendingBotStarts[String(telegramUser.id)] = {
        payload,
        updatedAt: new Date().toISOString(),
      }
      console.info('[referral] bot_start_pending_deferred', {
        telegramId: telegramUser.id,
        codePrefix: extractReferralCode(payload)?.slice(0, 2) || null,
      })
    }

    return {
      telegramId: Number(telegramUser.id),
      firstName: telegramUser.first_name || '',
      pendingStartParam: extractReferralCode(payload) ? payload : null,
      referralCode: '',
      created: false,
      deferred: true,
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
