import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REFERRAL_CONTEST_PRIZE_POOL,
  REFERRAL_CONTEST_PRIZES,
  buildMotivation,
  buildReferralContestRanking,
  canAccessReferralContest,
  getReferralContestConfig,
  getReferralContestStatus,
  prizeForPlace,
} from './referral-contest.mjs'

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
  // Same score: earlier time of reaching score 2 wins (#1 activated 2nd ref sooner)
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
  assert.equal(climb.needed, 3) // 16 - 14 + 1
  assert.equal(climb.currentPrize, 6_000)
  assert.equal(climb.nextPrize, 7_000)

  const enter = buildMotivation(11, 5, ranking)
  assert.equal(enter.kind, 'enter_top')
  assert.equal(enter.targetRank, 10)
  assert.equal(enter.needed, 4) // 8 - 5 + 1
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
})
