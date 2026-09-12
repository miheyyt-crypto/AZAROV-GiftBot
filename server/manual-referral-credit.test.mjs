import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ALLDEPWW_MANUAL_CREDIT,
  applyManualReferralCreditOnStore,
  getManualReferralCreditAmount,
  getManualReferralCreditRecord,
  manualReferralCreditCoinEventId,
  planManualReferralCredit,
} from './manual-referral-credit.mjs'
import {
  REFERRAL_CONTEST_ID,
  buildReferralContestRanking,
  getReferralContestConfig,
  stopReferralContestScheduler,
} from './referral-contest.mjs'
import { withStore } from './store.mjs'
import { countActiveReferrals, createUser, toPublicUser } from './users.mjs'
import { TX_TYPE } from './wallet.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-manual-ref-'))
  const previous = {
    store: process.env.AZAROV_STORE_DIR,
    enabled: process.env.REFERRAL_CONTEST_ENABLED,
    start: process.env.REFERRAL_CONTEST_START_AT,
    end: process.env.REFERRAL_CONTEST_END_AT,
  }
  process.env.AZAROV_STORE_DIR = dir
  process.env.REFERRAL_CONTEST_ENABLED = 'true'
  process.env.REFERRAL_CONTEST_START_AT = '2026-09-11T00:00:00.000Z'
  process.env.REFERRAL_CONTEST_END_AT = '2026-09-14T00:00:00.000Z'
  stopReferralContestScheduler()

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      stopReferralContestScheduler()
      if (previous.store === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous.store
      if (previous.enabled === undefined) delete process.env.REFERRAL_CONTEST_ENABLED
      else process.env.REFERRAL_CONTEST_ENABLED = previous.enabled
      if (previous.start === undefined) delete process.env.REFERRAL_CONTEST_START_AT
      else process.env.REFERRAL_CONTEST_START_AT = previous.start
      if (previous.end === undefined) delete process.env.REFERRAL_CONTEST_END_AT
      else process.env.REFERRAL_CONTEST_END_AT = previous.end
      rmSync(dir, { recursive: true, force: true })
    })
}

test('manual referral credit: first apply grants referrals+coins+earnings; second is noop', async () => {
  await withTempStore(async () => {
    const tgId = ALLDEPWW_MANUAL_CREDIT.telegramUserId
    const coinEventId = manualReferralCreditCoinEventId(ALLDEPWW_MANUAL_CREDIT.creditKey)

    withStore((store) => {
      createUser(store, {
        id: tgId,
        first_name: 'All',
        username: 'alldepww',
      })
      store.users[String(tgId)].balance = 1000
      store.users[String(tgId)].referralEarnings = 100
      return true
    })

    const plan = withStore((store) => planManualReferralCredit(store, ALLDEPWW_MANUAL_CREDIT), {
      readOnly: true,
    })
    assert.equal(plan.userExists, true)
    assert.equal(plan.wouldTouchStoreReferrals, false)
    assert.equal(plan.wouldCreatePhantomUsers, false)
    assert.equal(plan.wouldGrantCoins, true)
    assert.equal(plan.wouldBumpReferralEarnings, true)
    assert.equal(plan.wouldCallActivateReferral, false)
    assert.equal(plan.coinAmount, 25000)
    assert.equal(plan.alreadyApplied, false)

    const first = withStore((store) => {
      const beforeUsers = Object.keys(store.users || {}).length
      const beforeRefs = Object.keys(store.referrals || {}).length
      const beforeKick = Object.keys(store.kickAccounts || {}).length
      const beforeKickByTg = Object.keys(store.kickByTelegram || {}).length
      const beforeBalance = store.users[String(tgId)].balance
      const beforeEarnings = store.users[String(tgId)].referralEarnings
      const beforeDistinctTxIds = new Set(
        Object.values(store.coinTransactions || {}).map((tx) => tx?.id).filter(Boolean),
      )
      const userIdsBefore = new Set(Object.keys(store.users || {}))

      const result = applyManualReferralCreditOnStore(store, ALLDEPWW_MANUAL_CREDIT)

      assert.equal(result.success, true)
      assert.equal(result.applied, true)
      assert.equal(result.credit.kind, 'manual_referral_credit')
      assert.equal(result.credit.amount, 25)
      assert.equal(result.credit.coinAmount, 25000)
      assert.equal(result.credit.coinsGranted, true)
      assert.equal(result.credit.referralEarningsGranted, true)
      assert.equal(result.credit.coinEventId, coinEventId)
      assert.equal(result.credit.source, 'admin_script')

      assert.equal(Object.keys(store.users || {}).length, beforeUsers)
      assert.equal(Object.keys(store.referrals || {}).length, beforeRefs)
      assert.equal(Object.keys(store.kickAccounts || {}).length, beforeKick)
      assert.equal(Object.keys(store.kickByTelegram || {}).length, beforeKickByTg)
      assert.deepEqual([...Object.keys(store.users || {})].sort(), [...userIdsBefore].sort())

      assert.equal(store.users[String(tgId)].balance, beforeBalance + 25000)
      assert.equal(store.users[String(tgId)].referralEarnings, beforeEarnings + 25000)

      const afterDistinctTxIds = new Set(
        Object.values(store.coinTransactions || {}).map((tx) => tx?.id).filter(Boolean),
      )
      assert.equal(afterDistinctTxIds.size, beforeDistinctTxIds.size + 1)
      assert.ok(afterDistinctTxIds.has(coinEventId))

      const tx = store.coinTransactions[coinEventId]
      assert.ok(tx)
      assert.equal(tx.type, TX_TYPE.ADMIN_ADJUSTMENT)
      assert.equal(tx.amount, 25000)
      assert.equal(tx.userId, tgId)

      assert.equal(countActiveReferrals(store, tgId), 25)
      assert.equal(store.users[String(tgId)].activeReferrals, 25)

      const publicUser = toPublicUser(store.users[String(tgId)], store)
      assert.equal(publicUser.activeReferrals, 25)
      assert.equal(publicUser.referralEarnings, beforeEarnings + 25000)
      assert.equal(publicUser.balance, beforeBalance + 25000)
      return result
    })

    assert.equal(first.applied, true)

    const second = withStore((store) => {
      const beforeBalance = store.users[String(tgId)].balance
      const beforeEarnings = store.users[String(tgId)].referralEarnings
      const beforeDistinctTxIds = new Set(
        Object.values(store.coinTransactions || {}).map((tx) => tx?.id).filter(Boolean),
      )
      const beforeRefs = Object.keys(store.referrals || {}).length
      const beforeUsers = Object.keys(store.users || {}).length

      const result = applyManualReferralCreditOnStore(store, ALLDEPWW_MANUAL_CREDIT)
      assert.equal(result.success, true)
      assert.equal(result.applied, false)
      assert.equal(result.alreadyApplied, true)
      assert.equal(getManualReferralCreditAmount(store, tgId), 25)
      assert.equal(countActiveReferrals(store, tgId), 25)
      assert.equal(store.users[String(tgId)].balance, beforeBalance)
      assert.equal(store.users[String(tgId)].referralEarnings, beforeEarnings)
      const afterDistinctTxIds = new Set(
        Object.values(store.coinTransactions || {}).map((tx) => tx?.id).filter(Boolean),
      )
      assert.equal(afterDistinctTxIds.size, beforeDistinctTxIds.size)
      assert.equal(Object.keys(store.referrals || {}).length, beforeRefs)
      assert.equal(Object.keys(store.users || {}).length, beforeUsers)

      const credit = getManualReferralCreditRecord(store, tgId)
      assert.equal(credit.coinsGranted, true)
      assert.equal(credit.referralEarningsGranted, true)

      const publicUser = toPublicUser(store.users[String(tgId)], store)
      assert.equal(publicUser.referralEarnings, beforeEarnings)
      return result
    })

    assert.equal(second.alreadyApplied, true)
  })
})

test('manual referral credit counts in Referral Battle ranking without real refs', async () => {
  await withTempStore(async () => {
    const tgId = ALLDEPWW_MANUAL_CREDIT.telegramUserId
    const otherId = 9000000001

    withStore((store) => {
      createUser(store, { id: tgId, first_name: 'All', username: 'alldepww' })
      createUser(store, { id: otherId, first_name: 'Other', username: 'other' })
      store.referrals[`${otherId}:9000000002`] = {
        id: `${otherId}:9000000002`,
        referrerUserId: otherId,
        referredUserId: 9000000002,
        status: 'active',
        activatedAt: '2026-09-12T10:00:00.000Z',
        createdAt: '2026-09-12T09:00:00.000Z',
      }
      createUser(store, { id: 9000000002, first_name: 'Invitee', username: 'invitee' })
      applyManualReferralCreditOnStore(store, {
        ...ALLDEPWW_MANUAL_CREDIT,
        creditedAt: '2026-09-12T12:00:00.000Z',
      })
      return true
    })

    withStore((store) => {
      const config = getReferralContestConfig(store)
      assert.equal(config.id, REFERRAL_CONTEST_ID)
      const ranked = buildReferralContestRanking(store, config)
      const me = ranked.find((row) => row.telegramId === tgId)
      const other = ranked.find((row) => row.telegramId === otherId)
      assert.ok(me, 'manual-credit user must appear in ranking')
      assert.equal(me.score, 25)
      assert.equal(other.score, 1)
      assert.equal(ranked[0].telegramId, tgId)
      assert.equal(Object.keys(store.referrals).length, 1)
      return true
    }, { readOnly: true })
  })
})

test('manual referral credit stacks with real active referrals in count + contest', async () => {
  await withTempStore(async () => {
    const tgId = ALLDEPWW_MANUAL_CREDIT.telegramUserId
    const inviteeId = 9000000010

    withStore((store) => {
      createUser(store, { id: tgId, first_name: 'All', username: 'alldepww' })
      createUser(store, { id: inviteeId, first_name: 'Inv', username: 'inv' })
      store.referrals[`${tgId}:${inviteeId}`] = {
        id: `${tgId}:${inviteeId}`,
        referrerUserId: tgId,
        referredUserId: inviteeId,
        status: 'active',
        activatedAt: '2026-09-12T08:00:00.000Z',
        createdAt: '2026-09-12T07:00:00.000Z',
      }
      applyManualReferralCreditOnStore(store, {
        ...ALLDEPWW_MANUAL_CREDIT,
        creditedAt: '2026-09-12T12:00:00.000Z',
      })
      assert.equal(countActiveReferrals(store, tgId), 26)
      const ranked = buildReferralContestRanking(store, getReferralContestConfig(store))
      const me = ranked.find((row) => row.telegramId === tgId)
      assert.equal(me.score, 26)
      return true
    })
  })
})
