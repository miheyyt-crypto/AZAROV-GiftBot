import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createEmptyStore, withStore } from './store.mjs'
import {
  createPromoCodeOnStore,
  deactivatePromoCodeOnStore,
  normalizePromoCode,
  redeemPromoCodeOnStore,
} from './promo.mjs'
import { createUser } from './users.mjs'
import { listUserTransactions, TX_TYPE } from './wallet.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-promo-'))
  const previous = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      rmSync(dir, { recursive: true, force: true })
    })
}

function seedUser(store, telegramId, balance = 0) {
  createUser(store, {
    id: telegramId,
    first_name: `User${telegramId}`,
    username: `u${telegramId}`,
  })
  store.users[String(telegramId)].balance = balance
  return store.users[String(telegramId)]
}

test('normalizePromoCode uppercases and trims', () => {
  assert.equal(normalizePromoCode('  welcome100 '), 'WELCOME100')
  assert.equal(normalizePromoCode('Welcome100'), 'WELCOME100')
})

test('create rejects empty/zero/duplicate codes', async () => {
  await withTempStore(async () => {
    const empty = withStore((store) => createPromoCodeOnStore(store, { code: '', reward: 10, maxUses: 1 }))
    assert.equal(empty.success, false)
    assert.equal(empty.code, 'INVALID_CODE')

    const zeroReward = withStore((store) =>
      createPromoCodeOnStore(store, { code: 'OKAY', reward: 0, maxUses: 1, createdBy: 1 }),
    )
    assert.equal(zeroReward.success, false)
    assert.equal(zeroReward.code, 'INVALID_REWARD')

    const zeroUses = withStore((store) =>
      createPromoCodeOnStore(store, { code: 'OKAY', reward: 10, maxUses: 0, createdBy: 1 }),
    )
    assert.equal(zeroUses.success, false)
    assert.equal(zeroUses.code, 'INVALID_MAX_USES')

    const first = withStore((store) =>
      createPromoCodeOnStore(store, { code: 'WELCOME100', reward: 1000, maxUses: 2, createdBy: 99 }),
    )
    assert.equal(first.success, true)
    assert.equal(first.promo.code, 'WELCOME100')
    assert.equal(first.promo.reward, 1000)

    const dup = withStore((store) =>
      createPromoCodeOnStore(store, { code: 'welcome100', reward: 50, maxUses: 1, createdBy: 99 }),
    )
    assert.equal(dup.success, false)
    assert.equal(dup.code, 'PROMO_EXISTS')
  })
})

test('redeem grants once per user; second user can redeem while uses remain', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 1, 100)
      seedUser(store, 2, 0)
      createPromoCodeOnStore(store, { code: 'STREAM', reward: 500, maxUses: 10, createdBy: 9 })
    })

    const first = withStore((store) => redeemPromoCodeOnStore(store, 1, 'stream'))
    assert.equal(first.success, true)
    assert.equal(first.reward, 500)
    assert.equal(first.newBalance, 600)

    const again = withStore((store) => redeemPromoCodeOnStore(store, 1, 'STREAM'))
    assert.equal(again.success, false)
    assert.equal(again.code, 'PROMO_ALREADY_USED')

    const second = withStore((store) => redeemPromoCodeOnStore(store, 2, 'STREAM'))
    assert.equal(second.success, true)
    assert.equal(second.newBalance, 500)

    const txs = withStore((store) =>
      listUserTransactions(store, 1).filter((tx) => tx.type === TX_TYPE.PROMO_REWARD),
    )
    assert.equal(txs.length, 1)
    assert.equal(txs[0].amount, 500)
  })
})

test('maxUses=1 allows only one redeemer; double redeem is idempotent via lock', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 10, 0)
      seedUser(store, 11, 0)
      createPromoCodeOnStore(store, { code: 'ONCE', reward: 1000, maxUses: 1, createdBy: 1 })
    })

    const a = withStore((store) => redeemPromoCodeOnStore(store, 10, 'ONCE'))
    assert.equal(a.success, true)
    assert.equal(a.reward, 1000)

    const b = withStore((store) => redeemPromoCodeOnStore(store, 11, 'ONCE'))
    assert.equal(b.success, false)
    assert.equal(b.code, 'PROMO_EXHAUSTED')

    const double = withStore((store) => {
      const one = redeemPromoCodeOnStore(store, 10, 'ONCE')
      const two = redeemPromoCodeOnStore(store, 10, 'ONCE')
      return { one, two, balance: store.users['10'].balance }
    })
    assert.equal(double.one.success, false)
    assert.equal(double.one.code, 'PROMO_ALREADY_USED')
    assert.equal(double.two.success, false)
    assert.equal(double.balance, 1000)
  })
})

test('disabled promo cannot be redeemed', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 20, 0)
      createPromoCodeOnStore(store, { code: 'OFF', reward: 100, maxUses: 5, createdBy: 1 })
      deactivatePromoCodeOnStore(store, 'OFF')
    })

    const result = withStore((store) => redeemPromoCodeOnStore(store, 20, 'OFF'))
    assert.equal(result.success, false)
    assert.equal(result.code, 'PROMO_DISABLED')
  })
})

test('missing promo returns not found', async () => {
  await withTempStore(async () => {
    withStore((store) => seedUser(store, 30, 0))
    const result = withStore((store) => redeemPromoCodeOnStore(store, 30, 'NOPE'))
    assert.equal(result.success, false)
    assert.equal(result.code, 'PROMO_NOT_FOUND')
  })
})

test('store version includes promo maps', () => {
  const store = createEmptyStore()
  assert.equal(store.version, 16)
  assert.ok(store.promoCodes)
  assert.ok(store.promoUsages)
})
