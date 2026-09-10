import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import dropTables from '../src/data/case-drops.json' with { type: 'json' }

import { claimCaseCoins, getChanceTotal, isDropTableValid, openCase, buildCaseRollWeights, CASE_ROLL_SCALE, CASE_RUB_DROP_PERCENT, rollReward } from './cases.mjs'
import { withStore } from './store.mjs'
import { createUser } from './users.mjs'

test('all production case drop tables sum to exactly 100%', () => {
  for (const [caseId, rewards] of Object.entries(dropTables)) {
    assert.equal(
      getChanceTotal(rewards),
      100,
      `${caseId} drop table must sum to 100%`,
    )
    assert.equal(isDropTableValid(rewards), true)
  }
})

test('openCase heals corrupt array fields instead of 500', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-case-heal-'))
  const prev = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir

  try {
    withStore((store) => {
      const healthy = createUser(store, { id: 101, first_name: 'Ok', username: 'ok' })
      healthy.balance = 50_000

      const brokenInvitee = createUser(store, {
        id: 102,
        first_name: 'Broken',
        username: 'broken',
      })
      // Non-array invitedUsers used to crash migrateAllReferrals for every open.
      brokenInvitee.invitedUsers = { 0: { telegramId: 999, status: 'active' } }

      const opener = createUser(store, { id: 103, first_name: 'Open', username: 'open' })
      opener.balance = 50_000
      opener.caseOpenings = { not: 'an-array' }
      opener.earnedRewards = { also: 'bad' }
      return true
    })

    const result = openCase(103, 'poor', 'heal-corrupt-arrays-01')
    assert.equal(result.success, true, result.message)
    assert.ok(result.opening?.openingId)
    assert.ok(result.opening?.prize?.name)

    withStore(
      (store) => {
        const opener = store.users['103']
        assert.ok(Array.isArray(opener.caseOpenings))
        assert.ok(Array.isArray(opener.earnedRewards))
        assert.ok(opener.caseOpenings.length >= 1)
      },
      { readOnly: true },
    )
  } finally {
    if (prev === undefined) {
      delete process.env.AZAROV_STORE_DIR
    } else {
      process.env.AZAROV_STORE_DIR = prev
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('COINS from case stay in inventory until claimCaseCoins', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-case-claim-'))
  const prev = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir

  try {
    withStore((store) => {
      const user = createUser(store, { id: 201, first_name: 'Claim', username: 'claim' })
      user.balance = 50_000
      return true
    })

    let openingId = ''
    let rewardAmount = 0
    // Force a COINS drop by opening until we get one (or inject opening).
    for (let i = 0; i < 40; i += 1) {
      withStore((store) => {
        store.users['201'].balance = 50_000
      })
      const result = openCase(201, 'poor', `claim-coins-open-${i}`)
      assert.equal(result.success, true, result.message)
      if (String(result.opening?.rewardCurrency || '').toUpperCase() === 'COINS') {
        openingId = result.opening.openingId
        rewardAmount = Number(result.opening.rewardAmount)
        break
      }
    }

    if (!openingId) {
      // Deterministic fallback: inject a COINS opening if RNG never hit coins.
      withStore((store) => {
        const user = store.users['201']
        openingId = 'case:manual:201:coins'
        rewardAmount = 1500
        const opening = {
          openingId,
          caseId: 'poor',
          rewardId: 'manual-coins',
          rewardAmount,
          rewardCurrency: 'COINS',
          pricePaid: 0,
          prize: {
            id: 'manual-coins',
            name: '1500 монет',
            title: '1500 монет',
            amount: rewardAmount,
            currency: 'COINS',
            rarity: 'common',
          },
          createdAt: new Date().toISOString(),
          coinClaimStatus: 'AVAILABLE',
        }
        user.caseOpenings = [...(user.caseOpenings || []), opening]
        store.caseOpenings[openingId] = {
          id: openingId,
          userId: 201,
          caseId: 'poor',
          rewardId: 'manual-coins',
          rewardAmount,
          rewardCurrency: 'COINS',
          pricePaid: 0,
          createdAt: opening.createdAt,
          coinClaimStatus: 'AVAILABLE',
        }
      })
    }

    const balanceBefore = withStore((store) => Number(store.users['201'].balance), {
      readOnly: true,
    })

    const first = claimCaseCoins(201, openingId)
    assert.equal(first.success, true, first.message)
    assert.equal(first.alreadyClaimed, false)
    assert.equal(first.reward, rewardAmount)

    const balanceAfter = withStore((store) => Number(store.users['201'].balance), {
      readOnly: true,
    })
    assert.equal(balanceAfter, balanceBefore + rewardAmount)

    const second = claimCaseCoins(201, openingId)
    assert.equal(second.success, true)
    assert.equal(second.alreadyClaimed, true)
    const balanceFinal = withStore((store) => Number(store.users['201'].balance), {
      readOnly: true,
    })
    assert.equal(balanceFinal, balanceAfter)
  } finally {
    if (prev === undefined) {
      delete process.env.AZAROV_STORE_DIR
    } else {
      process.env.AZAROV_STORE_DIR = prev
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('display chance text stays 100% while each RUB prize rolls at 0.1%', () => {
  for (const [caseId, rewards] of Object.entries(dropTables)) {
    assert.equal(getChanceTotal(rewards), 100, `${caseId} display chances`)
    const weights = buildCaseRollWeights(rewards)
    const rubUnit = Math.round((CASE_RUB_DROP_PERCENT / 100) * CASE_ROLL_SCALE)
    const total = weights.reduce((sum, value) => sum + value, 0)
    assert.equal(total, CASE_ROLL_SCALE, `${caseId} roll weights`)

    rewards.forEach((reward, index) => {
      if (String(reward.currency).toUpperCase() === 'RUB') {
        assert.equal(weights[index], rubUnit, `${caseId}:${reward.id}`)
        assert.notEqual(reward.chance, CASE_RUB_DROP_PERCENT)
      }
    })
  }
})

test('rollReward simulation keeps each RUB near 0.1%', () => {
  const rewards = dropTables.poor
  const samples = 100_000
  const counts = Object.fromEntries(rewards.map((reward) => [reward.id, 0]))
  for (let i = 0; i < samples; i += 1) {
    const reward = rollReward(rewards)
    counts[reward.id] += 1
  }
  for (const reward of rewards) {
    if (String(reward.currency).toUpperCase() !== 'RUB') {
      continue
    }
    const rate = (counts[reward.id] / samples) * 100
    assert.ok(
      rate > 0.05 && rate < 0.2,
      `${reward.id} rate=${rate.toFixed(3)}% expected ~0.1%`,
    )
  }
})
