import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createEmptyStore, withStore } from './store.mjs'
import { createUser } from './users.mjs'
import {
  approveWithdrawalOnStore,
  createWithdrawalOnStore,
  isValidTronAddress,
  ITEM_WITHDRAWAL_STATUS,
  rejectWithdrawalOnStore,
  WITHDRAWAL_STATUS,
} from './withdrawals.mjs'

const VALID_TRON = 'TABCDEFGHJKLMNPQRSTUVWXYZabcdefghi'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-wd-'))
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

function seedUser(store, telegramId) {
  createUser(store, {
    id: telegramId,
    first_name: `User${telegramId}`,
    username: `u${telegramId}`,
  })
  return store.users[String(telegramId)]
}

function seedRubOpening(store, user, { openingId, amount = 5000 }) {
  const opening = {
    openingId,
    caseId: 'rich',
    rewardId: 'rich-rub-5000',
    rewardAmount: amount,
    rewardCurrency: 'RUB',
    pricePaid: 0,
    prize: { id: 'rich-rub-5000', name: `${amount} ₽`, amount, currency: 'RUB', rarity: 'legendary' },
    createdAt: new Date().toISOString(),
    withdrawalStatus: ITEM_WITHDRAWAL_STATUS.AVAILABLE,
    activeWithdrawalId: null,
  }
  user.caseOpenings = [...(user.caseOpenings || []), opening]
  store.caseOpenings[openingId] = {
    id: openingId,
    openingId,
    userId: user.telegramId,
    ...opening,
  }
  return opening
}

function seedCoinOpening(store, user, openingId) {
  const opening = {
    openingId,
    caseId: 'poor',
    rewardId: 'poor-coins-100',
    rewardAmount: 100,
    rewardCurrency: 'COINS',
    pricePaid: 0,
    prize: { id: 'poor-coins-100', name: '100 монет', amount: 100, currency: 'COINS', rarity: 'common' },
    createdAt: new Date().toISOString(),
  }
  user.caseOpenings = [...(user.caseOpenings || []), opening]
  store.caseOpenings[openingId] = { id: openingId, openingId, userId: user.telegramId, ...opening }
  return opening
}

test('TRON address validation', () => {
  assert.equal(isValidTronAddress(VALID_TRON), true)
  assert.equal(isValidTronAddress(` ${VALID_TRON} `), true)
  assert.equal(isValidTronAddress('T short'), false)
  assert.equal(isValidTronAddress('A' + VALID_TRON.slice(1)), false)
  assert.equal(isValidTronAddress('TXYZ abcdefghijklmnopqrstuvwxyz123456'), false)
})

test('rub item can withdraw; coins cannot; amount from item', async () => {
  await withTempStore(async () => {
    const created = withStore((store) => {
      const user = seedUser(store, 101)
      seedRubOpening(store, user, { openingId: 'open-rub-1', amount: 5000 })
      seedCoinOpening(store, user, 'open-coin-1')
      return createWithdrawalOnStore(store, 101, {
        itemId: 'open-rub-1',
        walletAddress: VALID_TRON,
        amountRub: 999999,
      })
    })
    assert.equal(created.success, true)
    assert.equal(created.withdrawal.amountRub, 5000)
    assert.equal(created.withdrawal.method, 'USDT_TRC20')
    assert.equal(created.withdrawal.status, WITHDRAWAL_STATUS.PENDING)

    const coins = withStore((store) =>
      createWithdrawalOnStore(store, 101, {
        itemId: 'open-coin-1',
        walletAddress: VALID_TRON,
      }),
    )
    assert.equal(coins.success, false)
    assert.equal(coins.code, 'NOT_WITHDRAWABLE')
  })
})

test('cannot withdraw foreign item or invalid wallet', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const owner = seedUser(store, 201)
      seedUser(store, 202)
      seedRubOpening(store, owner, { openingId: 'open-own', amount: 2000 })
    })

    const foreign = withStore((store) =>
      createWithdrawalOnStore(store, 202, {
        itemId: 'open-own',
        walletAddress: VALID_TRON,
      }),
    )
    assert.equal(foreign.success, false)
    assert.equal(foreign.code, 'ITEM_NOT_FOUND')

    const badWallet = withStore((store) =>
      createWithdrawalOnStore(store, 201, {
        itemId: 'open-own',
        walletAddress: 'not-a-tron-address',
      }),
    )
    assert.equal(badWallet.success, false)
    assert.equal(badWallet.code, 'INVALID_WALLET')
  })
})

test('pending blocks double request; reject restores; approve withdraws', async () => {
  await withTempStore(async () => {
    const first = withStore((store) => {
      const user = seedUser(store, 301)
      seedRubOpening(store, user, { openingId: 'open-once', amount: 1000 })
      return createWithdrawalOnStore(store, 301, {
        itemId: 'open-once',
        walletAddress: VALID_TRON,
      })
    })
    assert.equal(first.success, true)
    const wdId = first.withdrawal.id

    const double = withStore((store) => {
      const a = createWithdrawalOnStore(store, 301, {
        itemId: 'open-once',
        walletAddress: VALID_TRON,
      })
      const b = createWithdrawalOnStore(store, 301, {
        itemId: 'open-once',
        walletAddress: VALID_TRON,
      })
      return { a, b, opening: store.users['301'].caseOpenings[0] }
    })
    assert.equal(double.a.success, false)
    assert.equal(double.a.code, 'ALREADY_PENDING')
    assert.equal(double.b.success, false)
    assert.equal(double.opening.withdrawalStatus, ITEM_WITHDRAWAL_STATUS.PENDING_WITHDRAWAL)

    const rejected = withStore((store) => rejectWithdrawalOnStore(store, wdId, 999))
    assert.equal(rejected.success, true)
    assert.equal(rejected.withdrawal.status, WITHDRAWAL_STATUS.REJECTED)

    const restored = withStore((store) => store.users['301'].caseOpenings[0].withdrawalStatus)
    assert.equal(restored, ITEM_WITHDRAWAL_STATUS.AVAILABLE)

    const afterReject = withStore((store) =>
      createWithdrawalOnStore(store, 301, {
        itemId: 'open-once',
        walletAddress: VALID_TRON,
      }),
    )
    assert.equal(afterReject.success, true)

    const paidId = afterReject.withdrawal.id
    const approved = withStore((store) => approveWithdrawalOnStore(store, paidId, 999))
    assert.equal(approved.success, true)
    assert.equal(approved.withdrawal.status, WITHDRAWAL_STATUS.PAID)

    const afterPay = withStore((store) => ({
      opening: store.users['301'].caseOpenings[0],
      again: createWithdrawalOnStore(store, 301, {
        itemId: 'open-once',
        walletAddress: VALID_TRON,
      }),
      doubleApprove: approveWithdrawalOnStore(store, paidId, 999),
      rejectPaid: rejectWithdrawalOnStore(store, paidId, 999),
    }))
    assert.equal(afterPay.opening.withdrawalStatus, ITEM_WITHDRAWAL_STATUS.WITHDRAWN)
    assert.equal(afterPay.again.success, false)
    assert.equal(afterPay.again.code, 'ALREADY_WITHDRAWN')
    assert.equal(afterPay.doubleApprove.alreadyProcessed, true)
    assert.equal(afterPay.rejectPaid.success, false)
  })
})

test('store version includes withdrawals', () => {
  const store = createEmptyStore()
  assert.equal(store.version, 16)
  assert.ok(store.withdrawals)
})

test('withdrawal persists across store reload', async () => {
  await withTempStore(async () => {
    const created = withStore((store) => {
      const user = seedUser(store, 501)
      seedRubOpening(store, user, { openingId: 'open-persist', amount: 2000 })
      return createWithdrawalOnStore(store, 501, {
        itemId: 'open-persist',
        walletAddress: VALID_TRON,
      })
    })
    assert.equal(created.success, true)

    const reloaded = withStore((store) => {
      const wd = store.withdrawals[created.withdrawal.id]
      const opening = store.users['501'].caseOpenings[0]
      return {
        status: wd?.status,
        amount: wd?.amountRub,
        itemStatus: opening.withdrawalStatus,
        activeId: opening.activeWithdrawalId,
      }
    })
    assert.equal(reloaded.status, WITHDRAWAL_STATUS.PENDING)
    assert.equal(reloaded.amount, 2000)
    assert.equal(reloaded.itemStatus, ITEM_WITHDRAWAL_STATUS.PENDING_WITHDRAWAL)
    assert.equal(reloaded.activeId, created.withdrawal.id)
  })
})
