import assert from 'node:assert/strict'
import test from 'node:test'

import {
  activateReferralOnStore,
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
} from './users.mjs'

function makeStore() {
  return createEmptyStore()
}

function makeUser(store, id, name) {
  return createUser(store, { id, first_name: name, username: name.toLowerCase() })
}

test('extracts only ref_<CODE> start params', () => {
  assert.equal(extractReferralCode('ref_K8F4X2M9'), 'K8F4X2M9')
  assert.equal(extractReferralCode('ref_k8f4x2m9'), 'K8F4X2M9')
  assert.equal(extractReferralCode('K8F4X2M9'), null)
  assert.equal(extractReferralCode(''), null)
  assert.equal(extractReferralCode('start_K8F4X2M9'), null)
})

test('Test 1: B opening A link binds referredByUserId to A', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  const result = processReferral(store, userB, `ref_${userA.referralCode}`)

  assert.equal(result.applied, true)
  assert.equal(userB.referredByUserId, userA.telegramId)
  assert.equal(store.referrals[`${userA.telegramId}:${userB.telegramId}`].status, 'pending')
})

test('Test 2: repeating the same link does not create a second referral', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  processReferral(store, userB, `ref_${userA.referralCode}`)
  const second = processReferral(store, userB, `ref_${userA.referralCode}`)

  assert.equal(second.applied, false)
  assert.equal(second.reason, 'already_referred')
  assert.equal(Object.keys(store.referrals).length, 1)
})

test('Test 3: first referrer wins when B later opens C', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')
  const userC = makeUser(store, 333, 'C')

  processReferral(store, userB, `ref_${userA.referralCode}`)
  const second = processReferral(store, userB, `ref_${userC.referralCode}`)

  assert.equal(second.reason, 'already_referred')
  assert.equal(userB.referredByUserId, userA.telegramId)
  assert.equal(store.referrals[`${userC.telegramId}:${userB.telegramId}`], undefined)
})

test('Test 4: opening your own link does not create a referral', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const result = processReferral(store, userA, `ref_${userA.referralCode}`)

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'self_referral')
  assert.equal(Object.keys(store.referrals).length, 0)
  assert.equal(userA.referredByUserId, null)
})

test('Test 5: activation grants 500 to both users once Kick is verified', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  processReferral(store, userB, `ref_${userA.referralCode}`)
  userB.kickVerified = true

  const result = activateReferralOnStore(store, userB.telegramId)

  assert.equal(result.rewarded, true)
  assert.equal(userA.balance, 500)
  assert.equal(userB.balance, 500)
  assert.equal(userA.referralEarnings, 500)
  assert.equal(store.referrals[`${userA.telegramId}:${userB.telegramId}`].status, 'rewarded')

  const rewardTx = Object.values(store.coinTransactions).find(
    (item) => item.type === 'referral_reward' && item.userId === userA.telegramId,
  )
  assert.equal(rewardTx?.description, 'Награда за реферала')
})

test('Test 6: repeating activation does not grant more coins', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  processReferral(store, userB, `ref_${userA.referralCode}`)
  userB.kickVerified = true
  activateReferralOnStore(store, userB.telegramId)
  const second = activateReferralOnStore(store, userB.telegramId)

  assert.equal(second.rewarded, false)
  assert.equal(second.reason, 'already_granted')
  assert.equal(userA.balance, 500)
  assert.equal(userB.balance, 500)
})

test('Test 7: two sequential activation calls still grant coins only once', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  processReferral(store, userB, `ref_${userA.referralCode}`)
  userB.kickVerified = true

  const first = activateReferralOnStore(store, userB.telegramId)
  const second = activateReferralOnStore(store, userB.telegramId)

  assert.equal(first.rewarded, true)
  assert.equal(second.rewarded, false)
  assert.equal(userA.balance, 500)
  assert.equal(userB.balance, 500)
})

test('Test 8: referral code is permanent and unique', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')
  const codeBefore = userA.referralCode

  ensureUser(store, { id: 111, first_name: 'A', username: 'a' })
  assert.equal(userA.referralCode, codeBefore)
  assert.notEqual(userA.referralCode, userB.referralCode)
  assert.match(userA.referralCode, /^[A-Z0-9]{8}$/)
  assert.equal(formatReferralCode(userA.referralCode), `ref_${userA.referralCode}`)
})

test('Test 9-11: Friends stats and share link use the personal code', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')
  processReferral(store, userB, `ref_${userA.referralCode}`)

  const me = getReferralMe(store, userA)
  const expectedLink = `https://t.me/Bedolagy_GiftBot?startapp=ref_${userA.referralCode}`

  assert.equal(me.referralCode, `ref_${userA.referralCode}`)
  assert.equal(me.referralLink, expectedLink)
  assert.equal(me.invitedCount, 1)
  assert.equal(me.pendingCount, 1)
  assert.equal(me.activeCount, 0)
  assert.equal(me.caseProgress, 0)
  assert.equal(me.caseTarget, 5)
  assert.equal(me.availableReferralCases, 0)
  assert.equal(buildReferralLink(userA.referralCode), expectedLink)
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

  assert.equal(getReferralCaseStats(7, 1).caseProgress, 2)
  assert.equal(getReferralCaseStats(7, 1).availableReferralCases, 0)
})

test('opening link alone does not grant coins', () => {
  const store = makeStore()
  const userA = makeUser(store, 111, 'A')
  const userB = makeUser(store, 222, 'B')

  processReferral(store, userB, `ref_${userA.referralCode}`)

  assert.equal(userA.balance, 0)
  assert.equal(userB.balance, 0)
  assert.equal(store.referrals[`${userA.telegramId}:${userB.telegramId}`].status, 'pending')
})
