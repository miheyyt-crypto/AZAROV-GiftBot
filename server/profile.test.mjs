import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { getCoinHistory } from './profile.mjs'
import { withStore } from './store.mjs'
import { createUser } from './users.mjs'
import { addCoins, spendCoins, TX_TYPE } from './wallet.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-profile-hist-'))
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

test('empty ledger returns empty coin history', () => {
  withTempStore(() => {
    withStore((store) => {
      createUser(store, { id: 501, first_name: 'A', username: 'a501' })
    })

    const result = getCoinHistory(501, 'all')
    assert.equal(result.success, true)
    assert.deepEqual(result.transactions, [])
  })
})

test('credit appears as positive referral operation', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 502, first_name: 'B', username: 'b502' })
      addCoins(store, user, 500, TX_TYPE.REFERRAL_REWARD, 'hist:ref:502', {
        description: 'Награда за реферала (пригласивший)',
      })
    })

    const result = getCoinHistory(502, 'all')
    assert.equal(result.success, true)
    assert.equal(result.transactions.length, 1)
    assert.equal(result.transactions[0].amount, 500)
    assert.equal(result.transactions[0].type, 'referral_reward')
    assert.match(result.transactions[0].description, /реферал/i)
    assert.equal(result.transactions[0].balanceAfter, 500)
  })
})

test('debit appears as negative purchase operation', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 503, first_name: 'C', username: 'c503' })
      addCoins(store, user, 2000, TX_TYPE.ADMIN_ADJUSTMENT, 'hist:fund:503')
      spendCoins(store, user, 899, TX_TYPE.CASE_PURCHASE, 'hist:case:503', {
        description: 'Открытие кейса: Нищий кейс',
      })
    })

    const purchases = getCoinHistory(503, 'purchases')
    const all = getCoinHistory(503, 'all')
    assert.equal(purchases.transactions.length, 1)
    assert.equal(purchases.transactions[0].amount, -899)
    assert.equal(purchases.transactions[0].type, 'case_purchase')
    assert.match(purchases.transactions[0].description, /Нищий/)
    assert.equal(all.transactions.length, 2)
    assert.ok(
      new Date(all.transactions[0].createdAt).getTime() >=
        new Date(all.transactions[1].createdAt).getTime(),
    )
  })
})

test('Welvura partner reward and Kick task reward appear in rewards filter', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 504, first_name: 'D', username: 'd504' })
      addCoins(store, user, 1000, TX_TYPE.PARTNER_REWARD, 'hist:welvura:504', {
        description: 'Награда за задание Welvura: привязка аккаунта',
      })
      addCoins(store, user, 500, TX_TYPE.TASK_REWARD, 'hist:kick:504', {
        description: 'Награда за задание: фоллоу Kick',
      })
    })

    const rewards = getCoinHistory(504, 'rewards')
    assert.equal(rewards.transactions.length, 2)
    assert.equal(rewards.transactions[0].type, 'task_reward')
    assert.equal(rewards.transactions[1].type, 'partner_reward')
    assert.match(rewards.transactions[1].description, /Welvura/)
  })
})

test('user A history is not visible to user B', () => {
  withTempStore(() => {
    withStore((store) => {
      const a = createUser(store, { id: 505, first_name: 'E', username: 'e505' })
      createUser(store, { id: 506, first_name: 'F', username: 'f506' })
      addCoins(store, a, 1000, TX_TYPE.PARTNER_REWARD, 'hist:private:505', {
        description: 'Награда за задание Welvura: привязка аккаунта',
      })
    })

    const forA = getCoinHistory(505, 'all')
    const forB = getCoinHistory(506, 'all')
    assert.equal(forA.transactions.length, 1)
    assert.deepEqual(forB.transactions, [])
  })
})

test('operations are sorted newest first', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 507, first_name: 'G', username: 'g507' })
      addCoins(store, user, 100, TX_TYPE.TASK_REWARD, 'hist:old:507', {
        description: 'Старая',
      })
      store.coinTransactions['hist:old:507'].createdAt = '2020-01-01T00:00:00.000Z'
      addCoins(store, user, 200, TX_TYPE.REFERRAL_REWARD, 'hist:new:507', {
        description: 'Новая',
      })
    })

    const result = getCoinHistory(507, 'all')
    assert.equal(result.transactions.length, 2)
    assert.equal(result.transactions[0].id, 'hist:new:507')
    assert.equal(result.transactions[1].id, 'hist:old:507')
  })
})

test('frontend operations API no longer uses mock transactions', () => {
  const operationsApi = readFileSync(
    path.join(rootDir, 'src/services/api/operations.ts'),
    'utf8',
  )
  assert.equal(operationsApi.includes('MOCK_OPERATIONS'), false)
  assert.equal(operationsApi.includes('mockData/operations'), false)
  assert.match(operationsApi, /\/api\/profile\/coin-history/)

  let mockMissing = false
  try {
    readFileSync(path.join(rootDir, 'src/mockData/operations.ts'), 'utf8')
  } catch {
    mockMissing = true
  }
  assert.equal(mockMissing, true)
})
