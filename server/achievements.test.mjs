import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { achievementClaimEventId } from './achievements.mjs'
import {
  claimAchievement,
  claimAchievementOnStore,
  getAchievementsProgress,
  getCoinHistory,
} from './profile.mjs'
import { withStore } from './store.mjs'
import { createUser } from './users.mjs'
import { addCoins, TX_TYPE } from './wallet.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-achievements-'))
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

test('claim rejected when goal not completed', () => {
  withTempStore(() => {
    withStore((store) => {
      createUser(store, { id: 901, first_name: 'A', username: 'a901' })
      return true
    })

    const result = claimAchievement(901, 'friends')
    assert.equal(result.success, false)
    assert.equal(result.code, 'NOT_COMPLETED')

    withStore((store) => {
      assert.equal(store.users['901'].balance, 0)
      assert.equal((store.users['901'].claimedAchievements || []).includes('friends'), false)
      return true
    })
  })
})

test('claim succeeds when goal completed and credits server reward', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 902, first_name: 'B', username: 'b902' })
      user.streamHours = 100
      return true
    })

    const result = claimAchievement(902, 'stream-hours')
    assert.equal(result.success, true)
    assert.equal(result.rewarded, true)
    assert.equal(result.reward, 5000)
    assert.equal(result.achievement?.status, 'claimed')
    assert.equal(result.achievement?.claimed, true)

    withStore((store) => {
      assert.equal(store.users['902'].balance, 5000)
      assert.ok(store.users['902'].claimedAchievements.includes('stream-hours'))
      const tx = store.coinTransactions[achievementClaimEventId(902, 'stream-hours')]
      assert.ok(tx)
      assert.equal(tx.amount, 5000)
      assert.equal(tx.type, 'achievement_reward')
      return true
    })

    const history = getCoinHistory(902, 'rewards')
    assert.equal(history.transactions.filter((t) => t.type === 'achievement_reward').length, 1)
  })
})

test('repeat claim does not credit twice', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 903, first_name: 'C', username: 'c903' })
      user.chatMessages = 1000
      return true
    })

    const first = claimAchievement(903, 'chat-messages')
    assert.equal(first.success, true)
    assert.equal(first.rewarded, true)

    const second = claimAchievement(903, 'chat-messages')
    assert.equal(second.success, true)
    assert.equal(second.alreadyClaimed, true)
    assert.equal(second.rewarded, false)
    assert.equal(second.reward, 0)

    withStore((store) => {
      assert.equal(store.users['903'].balance, 3000)
      const rewardTx = Object.values(store.coinTransactions)
        .filter((t) => t.type === 'achievement_reward' && Number(t.userId) === 903)
        .filter((t, index, arr) => arr.findIndex((x) => x.id === t.id) === index)
      assert.equal(rewardTx.length, 1)
      assert.equal(rewardTx[0].amount, 3000)
      return true
    })
  })
})

test('concurrent claims in one lock grant once', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 904, first_name: 'D', username: 'd904' })
      user.streamHours = 150
      const a = claimAchievementOnStore(store, 904, 'stream-hours')
      const b = claimAchievementOnStore(store, 904, 'stream-hours')
      assert.equal(a.rewarded, true)
      assert.equal(a.reward, 5000)
      assert.equal(b.alreadyClaimed, true)
      assert.equal(b.rewarded, false)
      assert.equal(user.balance, 5000)
      return true
    })
  })
})

test('unknown achievement id is rejected', () => {
  withTempStore(() => {
    withStore((store) => {
      createUser(store, { id: 905, first_name: 'E', username: 'e905' })
      return true
    })
    const result = claimAchievement(905, 'not-a-real-achievement')
    assert.equal(result.success, false)
    assert.equal(result.code, 'UNKNOWN_ACHIEVEMENT')
  })
})

test('client cannot override reward — server uses catalog amount', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 906, first_name: 'F', username: 'f906' })
      user.streamHours = 100
      // Even if somehow a huge "requested" amount existed, claim ignores it.
      const result = claimAchievementOnStore(store, 906, 'stream-hours')
      assert.equal(result.reward, 5000)
      assert.equal(user.balance, 5000)
      return true
    })
  })
})

test('after claim status is claimed and progress counters still work', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 907, first_name: 'G', username: 'g907' })
      user.chatMessages = 1200
      return true
    })

    claimAchievement(907, 'chat-messages')
    const progress = getAchievementsProgress(907)
    const item = progress.achievements.find((a) => a.id === 'chat-messages')
    assert.equal(item.status, 'claimed')
    assert.equal(item.claimed, true)
    assert.equal(item.completed, true)
    assert.equal(item.current, 1000)

    withStore((store) => {
      store.users['907'].chatMessages = 1500
      return true
    })
    const again = getAchievementsProgress(907)
    assert.equal(again.achievements.find((a) => a.id === 'chat-messages').current, 1000)
    assert.equal(again.achievements.find((a) => a.id === 'chat-messages').claimed, true)
  })
})

test('coins-earned uses earned ledger sum, not balance alone', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 908, first_name: 'H', username: 'h908' })
      // Spent balance down, but earned sum is high.
      addCoins(store, user, 100_000, TX_TYPE.TASK_REWARD, 'earn:908')
      user.balance = 10
      return true
    })

    const before = getAchievementsProgress(908)
    assert.equal(before.achievements.find((a) => a.id === 'coins-earned').status, 'claimable')

    const claim = claimAchievement(908, 'coins-earned')
    assert.equal(claim.success, true)
    assert.equal(claim.reward, 5000)

    withStore((store) => {
      assert.equal(store.users['908'].balance, 5010)
      return true
    })
  })
})

test('user A claim does not affect user B', () => {
  withTempStore(() => {
    withStore((store) => {
      const a = createUser(store, { id: 909, first_name: 'I', username: 'i909' })
      createUser(store, { id: 910, first_name: 'J', username: 'j910' })
      a.streamHours = 100
      return true
    })

    claimAchievement(909, 'stream-hours')
    const b = getAchievementsProgress(910)
    assert.equal(b.achievements.find((a) => a.id === 'stream-hours').claimed, false)
    withStore((store) => {
      assert.equal(store.users['910'].balance, 0)
      assert.equal(store.users['909'].balance, 5000)
      return true
    })
  })
})
