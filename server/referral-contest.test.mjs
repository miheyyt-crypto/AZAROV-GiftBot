import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  REFERRAL_CONTEST_ID,
  REFERRAL_CONTEST_PRIZE_POOL,
  REFERRAL_CONTEST_PRIZES,
  buildMotivation,
  buildReferralContestRanking,
  buildWinnerTelegramText,
  canAccessReferralContest,
  contestRewardEventId,
  finalizeReferralContestOnStore,
  getReferralContestConfig,
  getReferralContestStatus,
  prizeForPlace,
  stopReferralContestScheduler,
} from './referral-contest.mjs'
import { NOTIFICATION_TYPE } from './notifications.mjs'
import { withStore } from './store.mjs'
import { createUser } from './users.mjs'
import { listUserTransactions, TX_TYPE } from './wallet.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-contest-'))
  const previous = {
    store: process.env.AZAROV_STORE_DIR,
    enabled: process.env.REFERRAL_CONTEST_ENABLED,
    adminOnly: process.env.REFERRAL_CONTEST_ADMIN_ONLY,
    start: process.env.REFERRAL_CONTEST_START_AT,
    end: process.env.REFERRAL_CONTEST_END_AT,
    admins: process.env.ADMIN_TELEGRAM_IDS,
  }
  process.env.AZAROV_STORE_DIR = dir
  process.env.REFERRAL_CONTEST_ENABLED = 'true'
  process.env.REFERRAL_CONTEST_ADMIN_ONLY = 'false'
  stopReferralContestScheduler()

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      stopReferralContestScheduler()
      if (previous.store === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous.store
      if (previous.enabled === undefined) delete process.env.REFERRAL_CONTEST_ENABLED
      else process.env.REFERRAL_CONTEST_ENABLED = previous.enabled
      if (previous.adminOnly === undefined) delete process.env.REFERRAL_CONTEST_ADMIN_ONLY
      else process.env.REFERRAL_CONTEST_ADMIN_ONLY = previous.adminOnly
      if (previous.start === undefined) delete process.env.REFERRAL_CONTEST_START_AT
      else process.env.REFERRAL_CONTEST_START_AT = previous.start
      if (previous.end === undefined) delete process.env.REFERRAL_CONTEST_END_AT
      else process.env.REFERRAL_CONTEST_END_AT = previous.end
      if (previous.admins === undefined) delete process.env.ADMIN_TELEGRAM_IDS
      else process.env.ADMIN_TELEGRAM_IDS = previous.admins
      rmSync(dir, { recursive: true, force: true })
    })
}

function seedUser(store, telegramId, extras = {}) {
  createUser(store, {
    id: telegramId,
    first_name: extras.firstName || `User${telegramId}`,
    username: extras.username || `u${telegramId}`,
  })
}

function seedActiveRef(store, referrerId, referredId, activatedAt) {
  seedUser(store, referredId)
  const id = `${referrerId}:${referredId}`
  store.referrals[id] = {
    id,
    referrerUserId: referrerId,
    referredUserId: referredId,
    status: 'active',
    activatedAt,
    createdAt: activatedAt,
  }
}

test('prize pool sums to 100000', () => {
  assert.equal(REFERRAL_CONTEST_PRIZE_POOL, 100_000)
  assert.equal(
    REFERRAL_CONTEST_PRIZES.reduce((sum, row) => sum + row.amount, 0),
    100_000,
  )
})

test('prizeForPlace returns configured amounts', () => {
  assert.equal(prizeForPlace(1), 25_000)
  assert.equal(prizeForPlace(10), 2_500)
  assert.equal(prizeForPlace(11), 0)
})

test('contest access respects enabled + adminOnly', () => {
  const prevEnabled = process.env.REFERRAL_CONTEST_ENABLED
  const prevAdmin = process.env.REFERRAL_CONTEST_ADMIN_ONLY
  const prevAdmins = process.env.ADMIN_TELEGRAM_IDS

  process.env.REFERRAL_CONTEST_ENABLED = 'false'
  process.env.REFERRAL_CONTEST_ADMIN_ONLY = 'true'
  process.env.ADMIN_TELEGRAM_IDS = '111'

  assert.equal(canAccessReferralContest(111).ok, false)
  assert.equal(canAccessReferralContest(111).code, 'CONTEST_DISABLED')

  process.env.REFERRAL_CONTEST_ENABLED = 'true'
  process.env.REFERRAL_CONTEST_ADMIN_ONLY = 'true'
  assert.equal(canAccessReferralContest(111).ok, true)
  assert.equal(canAccessReferralContest(222).ok, false)
  assert.equal(canAccessReferralContest(222).code, 'FORBIDDEN')

  process.env.REFERRAL_CONTEST_ADMIN_ONLY = 'false'
  assert.equal(canAccessReferralContest(222).ok, true)

  if (prevEnabled === undefined) delete process.env.REFERRAL_CONTEST_ENABLED
  else process.env.REFERRAL_CONTEST_ENABLED = prevEnabled
  if (prevAdmin === undefined) delete process.env.REFERRAL_CONTEST_ADMIN_ONLY
  else process.env.REFERRAL_CONTEST_ADMIN_ONLY = prevAdmin
  if (prevAdmins === undefined) delete process.env.ADMIN_TELEGRAM_IDS
  else process.env.ADMIN_TELEGRAM_IDS = prevAdmins
})

test('ranking counts only active/rewarded Kick referrals and tie-breaks by reachedAt', () => {
  const config = {
    ...getReferralContestConfig(),
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-12-31T00:00:00.000Z',
  }

  const store = {
    users: {
      1: { telegramId: 1, username: 'leader', firstName: 'A' },
      2: { telegramId: 2, username: 'second', firstName: 'B' },
      3: { telegramId: 3, username: 'third', firstName: 'C' },
    },
    referrals: {
      a: {
        referrerUserId: 1,
        referredUserId: 10,
        status: 'rewarded',
        activatedAt: '2026-02-01T00:00:00.000Z',
      },
      b: {
        referrerUserId: 1,
        referredUserId: 11,
        status: 'active',
        activatedAt: '2026-02-02T00:00:00.000Z',
      },
      c: {
        referrerUserId: 2,
        referredUserId: 12,
        status: 'rewarded',
        activatedAt: '2026-02-01T00:00:00.000Z',
      },
      d: {
        referrerUserId: 2,
        referredUserId: 13,
        status: 'active',
        activatedAt: '2026-02-03T00:00:00.000Z',
      },
      pending: {
        referrerUserId: 3,
        referredUserId: 14,
        status: 'pending',
        createdAt: '2026-02-01T00:00:00.000Z',
      },
      early: {
        referrerUserId: 3,
        referredUserId: 15,
        status: 'active',
        activatedAt: '2025-01-01T00:00:00.000Z',
      },
    },
  }

  const ranked = buildReferralContestRanking(store, config)
  assert.equal(ranked.length, 2)
  assert.equal(ranked[0].telegramId, 1)
  assert.equal(ranked[0].score, 2)
  assert.equal(ranked[1].telegramId, 2)
  assert.equal(ranked[1].score, 2)
  assert.ok(Date.parse(ranked[0].reachedAt) < Date.parse(ranked[1].reachedAt))
})

test('ranking ignores Kick activations before contest start and undated referrals', () => {
  const config = {
    ...getReferralContestConfig(),
    startsAt: '2026-09-11T12:50:00.000Z',
    endsAt: '2026-10-11T21:00:00.000Z',
  }

  const store = {
    users: {
      1: { telegramId: 1, username: 'old', firstName: 'Old' },
      2: { telegramId: 2, username: 'fresh', firstName: 'Fresh' },
    },
    referrals: {
      old: {
        referrerUserId: 1,
        referredUserId: 10,
        status: 'rewarded',
        activatedAt: '2026-09-10T10:00:00.000Z',
        createdAt: '2026-09-11T13:00:00.000Z',
      },
      undated: {
        referrerUserId: 1,
        referredUserId: 11,
        status: 'active',
        createdAt: '2026-09-11T13:00:00.000Z',
      },
      fresh: {
        referrerUserId: 2,
        referredUserId: 12,
        status: 'active',
        activatedAt: '2026-09-11T13:00:00.000Z',
      },
    },
  }

  const ranked = buildReferralContestRanking(store, config)
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0].telegramId, 2)
  assert.equal(ranked[0].score, 1)
})

test('motivation: start, climb, enter_top, leader', () => {
  const ranking = [
    { score: 50 },
    { score: 40 },
    { score: 30 },
    { score: 20 },
    { score: 18 },
    { score: 16 },
    { score: 14 },
    { score: 12 },
    { score: 10 },
    { score: 8 },
    { score: 5 },
  ]

  const start = buildMotivation(null, 0, ranking)
  assert.equal(start.kind, 'start')
  assert.equal(start.nextPrize, 2_500)

  const leader = buildMotivation(1, 50, ranking)
  assert.equal(leader.kind, 'leader')
  assert.equal(leader.leadBy, 10)
  assert.equal(leader.prize, 25_000)

  const climb = buildMotivation(7, 14, ranking)
  assert.equal(climb.kind, 'climb')
  assert.equal(climb.targetRank, 6)
  assert.equal(climb.needed, 3)
  assert.equal(climb.currentPrize, 6_000)
  assert.equal(climb.nextPrize, 7_000)

  const enter = buildMotivation(11, 5, ranking)
  assert.equal(enter.kind, 'enter_top')
  assert.equal(enter.targetRank, 10)
  assert.equal(enter.needed, 4)
  assert.equal(enter.nextPrize, 2_500)
})

test('contest status transitions', () => {
  const base = getReferralContestConfig()
  assert.equal(
    getReferralContestStatus({ ...base, enabled: false }, Date.parse('2026-09-15T00:00:00.000Z')),
    'disabled',
  )
  assert.equal(
    getReferralContestStatus(
      { ...base, enabled: true, startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' },
      Date.parse('2026-09-15T00:00:00.000Z'),
    ),
    'scheduled',
  )
  assert.equal(
    getReferralContestStatus(
      { ...base, enabled: true, startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z' },
      Date.parse('2026-09-15T00:00:00.000Z'),
    ),
    'active',
  )
  assert.equal(
    getReferralContestStatus(
      { ...base, enabled: true, startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-01T00:00:00.000Z' },
      Date.parse('2026-10-02T00:00:00.000Z'),
    ),
    'ended',
  )
  assert.equal(
    getReferralContestStatus(
      {
        ...base,
        enabled: true,
        storeStatus: 'finished',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-12-01T00:00:00.000Z',
      },
      Date.parse('2026-09-15T00:00:00.000Z'),
    ),
    'ended',
  )
})

test('finalize after END_AT pays TOP-10 once; second run is idempotent', async () => {
  await withTempStore(async () => {
    const startsAt = '2026-09-01T00:00:00.000Z'
    const endsAt = '2026-09-10T00:00:00.000Z'
    process.env.REFERRAL_CONTEST_START_AT = startsAt
    process.env.REFERRAL_CONTEST_END_AT = endsAt

    withStore((store) => {
      for (let place = 1; place <= 12; place += 1) {
        const referrerId = 1000 + place
        seedUser(store, referrerId, { username: `top${place}` })
        const score = 20 - place
        for (let i = 0; i < score; i += 1) {
          const day = String(2 + (i % 7)).padStart(2, '0')
          seedActiveRef(
            store,
            referrerId,
            referrerId * 100 + i,
            `2026-09-${day}T12:00:00.000Z`,
          )
        }
      }
    })

    const first = withStore((store) =>
      finalizeReferralContestOnStore(store, { nowIso: '2026-09-11T00:00:00.000Z' }),
    )
    assert.equal(first.success, true)
    assert.equal(first.alreadyFinalized, false)
    assert.equal(first.contest.status, 'finished')
    assert.equal(first.contest.results.length, 10)
    assert.equal(first.telegramJobs.length, 10)

    const prizeSum = first.contest.results.reduce((sum, row) => sum + row.prizeAmount, 0)
    assert.equal(prizeSum, 100_000)

    const balances = withStore((store) => {
      const map = {}
      for (const row of store.referralContests[REFERRAL_CONTEST_ID].results) {
        map[row.userId] = store.users[String(row.userId)].balance
        assert.equal(row.prizeStatus, 'paid')
        const txs = listUserTransactions(store, row.userId).filter(
          (tx) => tx.type === TX_TYPE.CONTEST_REWARD,
        )
        assert.equal(txs.length, 1)
        assert.equal(txs[0].amount, row.prizeAmount)
        assert.ok(
          Object.values(store.notifications).some(
            (n) =>
              Number(n.userId) === row.userId && n.type === NOTIFICATION_TYPE.CONTEST_WON,
          ),
        )
      }
      return map
    })
    assert.equal(balances[1001], 25_000)
    assert.equal(balances[1002], 17_000)
    assert.equal(balances[1010], 2_500)

    const second = withStore((store) =>
      finalizeReferralContestOnStore(store, { nowIso: '2026-09-12T00:00:00.000Z' }),
    )
    assert.equal(second.success, true)
    assert.equal(second.alreadyFinalized, true)

    withStore((store) => {
      for (const row of store.referralContests[REFERRAL_CONTEST_ID].results) {
        const txs = listUserTransactions(store, row.userId).filter(
          (tx) => tx.type === TX_TYPE.CONTEST_REWARD,
        )
        assert.equal(txs.length, 1)
        assert.equal(store.users[String(row.userId)].balance, balances[row.userId])
      }
    })
  })
})

test('finalize before END_AT is skipped; late worker after END_AT still finalizes', async () => {
  await withTempStore(async () => {
    process.env.REFERRAL_CONTEST_START_AT = '2026-09-01T00:00:00.000Z'
    process.env.REFERRAL_CONTEST_END_AT = '2026-09-10T12:00:00.000Z'

    withStore((store) => {
      seedUser(store, 42, { username: 'solo' })
      seedActiveRef(store, 42, 4201, '2026-09-02T00:00:00.000Z')
    })

    const early = withStore((store) =>
      finalizeReferralContestOnStore(store, { nowIso: '2026-09-10T11:59:00.000Z' }),
    )
    assert.equal(early.success, false)
    assert.equal(early.code, 'NOT_DUE')

    const late = withStore((store) =>
      finalizeReferralContestOnStore(store, { nowIso: '2026-09-10T12:10:00.000Z' }),
    )
    assert.equal(late.success, true)
    assert.equal(late.contest.status, 'finished')
    assert.equal(late.contest.results[0].userId, 42)
    assert.equal(late.contest.results[0].prizeAmount, 25_000)
  })
})

test('after FINISHED new Kick referrals do not change frozen ranking', async () => {
  await withTempStore(async () => {
    process.env.REFERRAL_CONTEST_START_AT = '2026-09-01T00:00:00.000Z'
    process.env.REFERRAL_CONTEST_END_AT = '2026-09-10T00:00:00.000Z'

    withStore((store) => {
      seedUser(store, 1, { username: 'a' })
      seedUser(store, 2, { username: 'b' })
      seedActiveRef(store, 1, 11, '2026-09-02T00:00:00.000Z')
      seedActiveRef(store, 1, 12, '2026-09-03T00:00:00.000Z')
      seedActiveRef(store, 2, 21, '2026-09-02T00:00:00.000Z')
    })

    withStore((store) =>
      finalizeReferralContestOnStore(store, { nowIso: '2026-09-11T00:00:00.000Z' }),
    )

    withStore((store) => {
      // Even with activatedAt inside original window, frozen ranking must stay.
      seedActiveRef(store, 2, 22, '2026-09-04T00:00:00.000Z')
      seedActiveRef(store, 2, 23, '2026-09-05T00:00:00.000Z')
      seedActiveRef(store, 2, 24, '2026-09-06T00:00:00.000Z')

      const contest = store.referralContests[REFERRAL_CONTEST_ID]
      assert.equal(contest.status, 'finished')
      assert.equal(contest.ranking[0].userId, 1)
      assert.equal(contest.ranking[0].score, 2)
      assert.equal(contest.results[0].userId, 1)
      assert.equal(contest.results[0].prizeAmount, 25_000)
    })
  })
})

test('concurrent finalize does not double-pay (same store lock serialization)', async () => {
  await withTempStore(async () => {
    process.env.REFERRAL_CONTEST_START_AT = '2026-09-01T00:00:00.000Z'
    process.env.REFERRAL_CONTEST_END_AT = '2026-09-10T00:00:00.000Z'

    withStore((store) => {
      seedUser(store, 7, { username: 'winner' })
      seedActiveRef(store, 7, 71, '2026-09-02T00:00:00.000Z')
    })

    const a = withStore((store) =>
      finalizeReferralContestOnStore(store, { nowIso: '2026-09-11T00:00:00.000Z' }),
    )
    const b = withStore((store) =>
      finalizeReferralContestOnStore(store, { nowIso: '2026-09-11T00:00:01.000Z' }),
    )
    assert.equal(a.success, true)
    assert.equal(b.success, true)
    assert.equal(a.alreadyFinalized, false)
    assert.equal(b.alreadyFinalized, true)

    withStore((store) => {
      const txs = listUserTransactions(store, 7).filter((tx) => tx.type === TX_TYPE.CONTEST_REWARD)
      assert.equal(txs.length, 1)
      assert.equal(store.users['7'].balance, 25_000)
      assert.equal(
        contestRewardEventId(REFERRAL_CONTEST_ID, 1, 7),
        'referral_contest:referral-battle-2026:place:1:user:7',
      )
    })
  })
})

test('winner telegram copy covers top places; payout text independent of send success', () => {
  const first = buildWinnerTelegramText({ place: 1, score: 10, prizeAmount: 25_000 })
  assert.match(first, /ТЫ ПОБЕДИТЕЛЬ/)
  const tenth = buildWinnerTelegramText({ place: 10, score: 2, prizeAmount: 2_500 })
  assert.match(tenth, /ПРИЗОВОЙ ДЕСЯТКЕ/)
  assert.match(tenth, /#10/)
})
