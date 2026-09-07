import assert from 'node:assert/strict'
import test from 'node:test'

import { getReferralActivationReward } from './constants.mjs'
import { linkKickAccountOnStore } from './kick-oauth.mjs'
import {
  activateReferralOnStore,
  applyReferralAndReward,
  getReferralCaseStats,
  getReferralMe,
  processReferral,
} from './referrals.mjs'
import { createEmptyStore } from './store.mjs'
import {
  buildReferralLink,
  createUser,
  ensureUser,
  extractReferralCode,
  formatReferralCode,
  resolveReferralStartParam,
} from './users.mjs'

function makeStore() {
  return createEmptyStore()
}

function makeUser(store, id, name) {
  return createUser(store, { id, first_name: name, username: name.toLowerCase() })
}

function linkKick(store, user, kickUserId = String(9000 + Number(user.telegramId))) {
  const result = linkKickAccountOnStore(store, user.telegramId, {
    kickUserId: String(kickUserId),
    username: `kick_${user.telegramId}`,
    displayName: user.firstName,
    avatarUrl: null,
  })
  assert.equal(result.ok, true)
  return result
}

const REWARD = getReferralActivationReward()

test('extracts ref_ prefix and bare referral codes', () => {
  assert.equal(extractReferralCode('ref_K8F4X2M9'), 'K8F4X2M9')
  assert.equal(extractReferralCode('ref_k8f4x2m9'), 'K8F4X2M9')
  assert.equal(extractReferralCode('K8F4X2M9'), 'K8F4X2M9')
  assert.equal(extractReferralCode(''), null)
  assert.equal(extractReferralCode('start_K8F4X2M9'), null)
  assert.equal(extractReferralCode('nope'), null)
})

test('resolveReferralStartParam prefers signed initData then client then pending', () => {
  assert.equal(
    resolveReferralStartParam({
      signed: 'ref_AAAA1111',
      client: 'ref_BBBB2222',
      pending: 'ref_CCCC3333',
    }).source,
    'init_data',
  )
  assert.equal(
    resolveReferralStartParam({
      signed: '',
      client: 'ref_BBBB2222',
      pending: 'ref_CCCC3333',
    }).source,
    'client',
  )
  assert.equal(
    resolveReferralStartParam({
      signed: '',
      client: '',
      pending: 'ref_CCCC3333',
    }).source,
    'pending',
  )
})

test('Test 1: A has a unique referral code', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  assert.match(userA.referralCode, /^[A-Z0-9]{8}$/)
  assert.notEqual(userA.referralCode, userB.referralCode)
  assert.equal(formatReferralCode(userA.referralCode), `ref_${userA.referralCode}`)
})

test('Test 1: link alone stays pending — no coins until Kick', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  const { referral, activation } = applyReferralAndReward(
    store,
    userB,
    `ref_${userA.referralCode}`,
  )

  assert.equal(referral.applied, true)
  assert.equal(activation.rewarded, false)
  assert.equal(activation.reason, 'kick_required')
  assert.equal(userB.referredByUserId, userA.telegramId)
  assert.equal(userA.balance, 0)
  assert.equal(userB.balance, 0)
  assert.equal(store.referrals[`${userA.telegramId}:${userB.telegramId}`].status, 'pending')

  const me = getReferralMe(store, userA)
  assert.equal(me.invitedCount, 1)
  assert.equal(me.activeCount, 0)
  assert.equal(me.pendingCount, 1)
  assert.equal(me.earnedCoins, 0)
})

test('Test 1b: Kick link confirms referral — both get +500 once', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  applyReferralAndReward(store, userB, `ref_${userA.referralCode}`)
  const linked = linkKick(store, userB, '900')

  assert.equal(linked.referralActivation?.rewarded, true)
  assert.equal(userA.balance, REWARD)
  assert.equal(userB.balance, REWARD + 400) // + referral + kick-connect task
  assert.equal(userA.referralEarnings, REWARD)
  assert.equal(store.referrals[`${userA.telegramId}:${userB.telegramId}`].status, 'rewarded')

  const me = getReferralMe(store, userA)
  assert.equal(me.activeCount, 1)
  assert.equal(me.pendingCount, 0)
  assert.equal(me.earnedCoins, REWARD)
})

test('Test 1c: concrete production-style code rewards after Kick only once', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  userA.referralCode = 'LMEK2RC6'
  store.referralIndex.LMEK2RC6 = userA.telegramId

  const userB = makeUser(store, 222, 'B')
  const { referral, activation } = applyReferralAndReward(store, userB, 'ref_LMEK2RC6')

  assert.equal(referral.applied, true)
  assert.equal(activation.reason, 'kick_required')
  assert.equal(userA.balance, 0)
  assert.equal(userB.balance, 0)

  linkKick(store, userB, '901')
  assert.equal(userA.balance, REWARD)
  assert.equal(userB.balance, REWARD + 400)

  const again = applyReferralAndReward(store, userB, 'ref_LMEK2RC6')
  assert.equal(again.activation.rewarded, false)
  assert.equal(again.activation.reason, 'already_granted')
  assert.equal(userA.balance, REWARD)
  assert.equal(userB.balance, REWARD + 400)
})

test('Test 2-3: reopen / refresh / re-OAuth does not grant again', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  applyReferralAndReward(store, userB, `ref_${userA.referralCode}`)
  linkKick(store, userB, '902')

  const balanceA = userA.balance
  const balanceB = userB.balance

  const second = applyReferralAndReward(store, userB, `ref_${userA.referralCode}`)
  const third = activateReferralOnStore(store, userB.telegramId)
  const fourth = linkKickAccountOnStore(store, userB.telegramId, {
    kickUserId: '902',
    username: 'kick_222',
    displayName: 'B',
    avatarUrl: null,
  })

  assert.equal(second.referral.reason, 'already_referred')
  assert.equal(second.activation.reason, 'already_granted')
  assert.equal(third.reason, 'already_granted')
  assert.equal(fourth.referralActivation?.reason, 'already_granted')
  assert.equal(userA.balance, balanceA)
  assert.equal(userB.balance, balanceB)
})

test('Test 4: self-referral is blocked', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const result = processReferral(store, userA, `ref_${userA.referralCode}`)

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'self_referral')
  assert.equal(Object.keys(store.referrals).length, 0)
  assert.equal(userA.referredByUserId, null)
  assert.equal(userA.balance, 0)
})

test('Test 5: invalid code still allows registration without referrer', () => {
  const store = makeStore()
  const userB = makeUser(store, 222, 'B')
  const { referral, activation } = applyReferralAndReward(store, userB, 'ref_ZZZZZZZZ')

  assert.equal(referral.reason, 'invalid_code')
  assert.equal(activation.reason, 'no_referrer')
  assert.equal(userB.referredByUserId, null)
  assert.equal(userB.balance, 0)
  assert.equal(Object.keys(store.referrals).length, 0)
})

test('Test 6: first referrer wins when B later opens C', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')
  const userC = makeUser(store, 333, 'C')

  applyReferralAndReward(store, userB, `ref_${userA.referralCode}`)
  const second = applyReferralAndReward(store, userB, `ref_${userC.referralCode}`)
  linkKick(store, userB, '903')

  assert.equal(second.referral.reason, 'already_referred')
  assert.equal(userB.referredByUserId, userA.telegramId)
  assert.equal(store.referrals[`${userC.telegramId}:${userB.telegramId}`], undefined)
  assert.equal(userA.balance, REWARD)
  assert.equal(userC.balance, 0)
  assert.equal(userC.referralEarnings || 0, 0)
})

test('Test 7: sequential concurrent-like reward attempts grant only once each', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  processReferral(store, userB, `ref_${userA.referralCode}`)
  linkKick(store, userB, '904')
  // Kick link already activated; further activates are no-ops
  const second = activateReferralOnStore(store, userB.telegramId)
  const third = activateReferralOnStore(store, userB.telegramId)

  assert.equal(second.rewarded, false)
  assert.equal(third.rewarded, false)
  assert.equal(userA.balance, REWARD)
  assert.equal(userB.balance, REWARD + 400)

  const inviterTx = Object.values(store.coinTransactions)
    .filter((item) => item.type === 'referral_reward' && item.userId === userA.telegramId)
    .filter((item, index, arr) => arr.findIndex((row) => row.id === item.id) === index)
  const inviteeTx = Object.values(store.coinTransactions)
    .filter((item) => item.type === 'referral_reward' && item.userId === userB.telegramId)
    .filter((item, index, arr) => arr.findIndex((row) => row.id === item.id) === index)
  assert.equal(inviterTx.length, 1)
  assert.equal(inviteeTx.length, 1)
})

test('Test 8: Kick already linked then referral link confirms immediately', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')
  linkKick(store, userB, '905')

  const balanceBBefore = userB.balance
  const { referral, activation } = applyReferralAndReward(
    store,
    userB,
    `ref_${userA.referralCode}`,
  )

  assert.equal(referral.applied, true)
  assert.equal(activation.rewarded, true)
  assert.equal(userA.balance, REWARD)
  assert.equal(userB.balance, balanceBBefore + REWARD)
})

test('Test 9: delayed Kick link still confirms pending referral', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  applyReferralAndReward(store, userB, `ref_${userA.referralCode}`)
  assert.equal(userA.balance, 0)

  // Simulate days later — reopen without Kick still pending
  const reopen = applyReferralAndReward(store, userB, `ref_${userA.referralCode}`)
  assert.equal(reopen.activation.reason, 'kick_required')
  assert.equal(userA.balance, 0)

  linkKick(store, userB, '906')
  assert.equal(userA.balance, REWARD)
  assert.equal(userB.balance, REWARD + 400)
})

test('Test 10: user without referrer linking Kick gets no referral reward', () => {
  const store = makeStore()
  const userB = makeUser(store, 222, 'B')
  const linked = linkKick(store, userB, '907')

  assert.equal(linked.referralActivation?.reason, 'no_referrer')
  assert.equal(userB.balance, 400) // kick-connect only
})

test('Test 11: legacy user without referralCode gets one without backfill referrer', () => {
  const store = makeStore()
  store.users['999'] = {
    telegramId: 999,
    firstName: 'Legacy',
    username: 'legacy',
    balance: 42,
    referredByUserId: null,
    referredBy: null,
    invitedUsers: [],
    completedTasks: [],
  }

  const user = ensureUser(store, { id: 999, first_name: 'Legacy', username: 'legacy' })

  assert.match(user.referralCode, /^[A-Z0-9]{8}$/)
  assert.equal(user.balance, 42)
  assert.equal(user.referredByUserId, null)
  assert.equal(user.referralEarnings, 0)
})

test('binding alone without activate does not grant coins', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  processReferral(store, userB, `ref_${userA.referralCode}`)

  assert.equal(userA.balance, 0)
  assert.equal(userB.balance, 0)
  assert.equal(store.referrals[`${userA.telegramId}:${userB.telegramId}`].status, 'pending')
})

test('Friends stats and share link use the personal code', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')
  applyReferralAndReward(store, userB, `ref_${userA.referralCode}`)
  linkKick(store, userB, '908')

  const me = getReferralMe(store, userA)
  const expectedLink = buildReferralLink(userA.referralCode)

  assert.equal(me.referralCode, `ref_${userA.referralCode}`)
  assert.equal(me.referralLink, expectedLink)
  assert.equal(me.invitedCount, 1)
  assert.equal(me.pendingCount, 0)
  assert.equal(me.activeCount, 1)
  assert.match(expectedLink, /^https:\/\/t\.me\/[^?]+\?startapp=ref_/)
})

test('referral case progress uses active referrals and resets after grant', () => {
  assert.deepEqual(getReferralCaseStats(0, 0), {
    caseProgress: 0,
    caseTarget: 5,
    availableReferralCases: 0,
    earnedReferralCases: 0,
    openedReferralCases: 0,
  })

  assert.equal(getReferralCaseStats(5, 0).availableReferralCases, 1)
  assert.equal(getReferralCaseStats(5, 0).caseProgress, 5)
  assert.equal(getReferralCaseStats(5, 1).availableReferralCases, 0)
  assert.equal(getReferralCaseStats(5, 1).caseProgress, 0)
})
