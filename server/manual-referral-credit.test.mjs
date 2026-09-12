import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ALLDEPWW_MANUAL_CREDIT,
  applyManualReferralCreditOnStore,
  getManualReferralCreditAmount,
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

test('manual referral credit: apply once, idempotent, no phantom referrals', async () => {
  await withTempStore(async () => {
    const tgId = ALLDEPWW_MANUAL_CREDIT.telegramUserId

    withStore((store) => {
      createUser(store, {
        id: tgId,
        first_name: 'All',
        username: 'alldepww',
      })
      store.users[String(tgId)].balance = 1000
      return true
    })

    const plan = withStore((store) => planManualReferralCredit(store, ALLDEPWW_MANUAL_CREDIT), {
      readOnly: true,
    })
    assert.equal(plan.userExists, true)
    assert.equal(plan.wouldTouchStoreReferrals, false)
    assert.equal(plan.wouldCreatePhantomUsers, false)
    assert.equal(plan.wouldGrantCoins, false)
    assert.equal(plan.alreadyApplied, false)

    const first = withStore((store) => {
      const beforeUsers = Object.keys(store.users || {}).length
      const beforeRefs = Object.keys(store.referrals || {}).length
      const beforeKick = Object.keys(store.kickAccounts || {}).length
      const beforeBalance = store.users[String(tgId)].balance
      const beforeTx = Object.keys(store.coinTransactions || {}).length

      const result = applyManualReferralCreditOnStore(store, ALLDEPWW_MANUAL_CREDIT)

      assert.equal(result.success, true)
      assert.equal(result.applied, true)
      assert.equal(result.credit.kind, 'manual_referral_credit')
      assert.equal(result.credit.amount, 25)
      assert.equal(result.credit.source, 'admin_script')
      assert.equal(Object.keys(store.users || {}).length, beforeUsers)
      assert.equal(Object.keys(store.referrals || {}).length, beforeRefs)
      assert.equal(Object.keys(store.kickAccounts || {}).length, beforeKick)
      assert.equal(store.users[String(tgId)].balance, beforeBalance)
      assert.equal(Object.keys(store.coinTransactions || {}).length, beforeTx)
      assert.equal(countActiveReferrals(store, tgId), 25)
      assert.equal(store.users[String(tgId)].activeReferrals, 25)
      return result
    })

    assert.equal(first.applied, true)

    const second = withStore((store) => {
      const result = applyManualReferralCreditOnStore(store, ALLDEPWW_MANUAL_CREDIT)
      assert.equal(result.success, true)
      assert.equal(result.applied, false)
      assert.equal(result.alreadyApplied, true)
      assert.equal(getManualReferralCreditAmount(store, tgId), 25)
      assert.equal(countActiveReferrals(store, tgId), 25)
      return result
    })

    assert.equal(second.alreadyApplied, true)

    withStore((store) => {
      const publicUser = toPublicUser(store.users[String(tgId)], store)
      assert.equal(publicUser.activeReferrals, 25)
      return true
    }, { readOnly: true })
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
