import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { XP_PER_LEVEL } from './level.mjs'
import {
  grantPendingLevelRewardsOnStore,
  levelRewardAmount,
  levelRewardEventId,
  seedClaimedLevelRewardsWithoutGrant,
} from './level-rewards.mjs'
import { withStore } from './store.mjs'
import { createUser, toPublicUser } from './users.mjs'
import { listUserTransactions, TX_TYPE } from './wallet.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-level-rewards-'))
  const previous = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.AZAROV_STORE_DIR
    else process.env.AZAROV_STORE_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

test('level reward formula level × 50', () => {
  assert.equal(levelRewardAmount(1), 50)
  assert.equal(levelRewardAmount(2), 100)
  assert.equal(levelRewardAmount(5), 250)
  assert.equal(levelRewardAmount(10), 500)
  assert.equal(levelRewardAmount(20), 1000)
  assert.equal(levelRewardAmount(50), 2500)
  assert.equal(levelRewardAmount(100), 5000)
  assert.equal(levelRewardAmount(0), 0)
})

test('new user level 1 grants 50 once', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 9101, first_name: 'N', username: 'n9101' })
      assert.equal(user.levelRewardsSeeded, true)
      assert.deepEqual(user.claimedLevelRewards, [])

      const first = grantPendingLevelRewardsOnStore(store, user)
      assert.equal(first.totalAmount, 50)
      assert.deepEqual(first.granted, [{ level: 1, amount: 50 }])
      assert.equal(user.balance, 50)

      const second = grantPendingLevelRewardsOnStore(store, user)
      assert.equal(second.totalAmount, 0)
      assert.equal(second.granted.length, 0)
      assert.equal(user.balance, 50)

      const txs = listUserTransactions(store, user.telegramId).filter(
        (tx) => tx.type === TX_TYPE.LEVEL_REWARD,
      )
      assert.equal(txs.length, 1)
      assert.equal(txs[0].id, levelRewardEventId(user.telegramId, 1))
      return true
    })
  })
})

test('level 1 → 2 grants 100', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 9102, first_name: 'A', username: 'a9102' })
      grantPendingLevelRewardsOnStore(store, user)
      assert.equal(user.balance, 50)

      user.chatMessages = XP_PER_LEVEL
      const result = grantPendingLevelRewardsOnStore(store, user)
      assert.deepEqual(result.granted, [{ level: 2, amount: 100 }])
      assert.equal(result.totalAmount, 100)
      assert.equal(user.balance, 150)
      return true
    })
  })
})

test('level 4 → 5 grants 250', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 9103, first_name: 'B', username: 'b9103' })
      seedClaimedLevelRewardsWithoutGrant(user, 4)
      user.chatMessages = XP_PER_LEVEL * 4
      const result = grantPendingLevelRewardsOnStore(store, user)
      assert.deepEqual(result.granted, [{ level: 5, amount: 250 }])
      assert.equal(user.balance, 250)
      return true
    })
  })
})

test('multi-level jump 4 → 7 grants 250+300+350', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 9104, first_name: 'C', username: 'c9104' })
      seedClaimedLevelRewardsWithoutGrant(user, 4)
      user.chatMessages = XP_PER_LEVEL * 6
      const result = grantPendingLevelRewardsOnStore(store, user)
      assert.deepEqual(result.granted, [
        { level: 5, amount: 250 },
        { level: 6, amount: 300 },
        { level: 7, amount: 350 },
      ])
      assert.equal(result.totalAmount, 900)
      assert.equal(user.balance, 900)

      const again = grantPendingLevelRewardsOnStore(store, user)
      assert.equal(again.totalAmount, 0)
      assert.equal(user.balance, 900)
      return true
    })
  })
})

test('unseeded legacy user is seeded without backfill payout', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 9105, first_name: 'L', username: 'l9105' })
      user.chatMessages = XP_PER_LEVEL * 19
      delete user.levelRewardsSeeded
      delete user.claimedLevelRewards

      const result = grantPendingLevelRewardsOnStore(store, user)
      assert.equal(result.seededWithoutGrant, true)
      assert.equal(result.totalAmount, 0)
      assert.equal(user.balance, 0)
      assert.equal(user.levelRewardsSeeded, true)
      assert.ok(user.claimedLevelRewards.includes(20))

      user.chatMessages = XP_PER_LEVEL * 20
      const next = grantPendingLevelRewardsOnStore(store, user)
      assert.deepEqual(next.granted, [{ level: 21, amount: 1050 }])
      assert.equal(user.balance, 1050)
      return true
    })
  })
})

test('store migration v11 seeds existing users without paying', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 9106, first_name: 'M', username: 'm9106' })
      user.chatMessages = XP_PER_LEVEL * 9
      delete user.levelRewardsSeeded
      delete user.claimedLevelRewards
      store.version = 10
      return true
    })

    withStore((store) => {
      assert.equal(store.version, 16)
      const user = store.users['9106']
      assert.equal(user.levelRewardsSeeded, true)
      assert.ok(user.claimedLevelRewards.includes(10))
      assert.equal(user.balance, 0)
      const grant = grantPendingLevelRewardsOnStore(store, user)
      assert.equal(grant.totalAmount, 0)
      return true
    })
  })
})

test('public user exposes nextLevelReward', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 9107, first_name: 'P', username: 'p9107' })
      seedClaimedLevelRewardsWithoutGrant(user, 4)
      user.chatMessages = XP_PER_LEVEL * 3 + 10
      const pub = toPublicUser(user, store)
      assert.equal(pub.level, 4)
      assert.equal(pub.nextLevelReward, 250)
      return true
    })
  })
})
