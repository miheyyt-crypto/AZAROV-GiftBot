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
  isValidWelvuraId,
  ITEM_WITHDRAWAL_STATUS,
  rejectWithdrawalOnStore,
  WITHDRAWAL_STATUS,
} from './withdrawals.mjs'
import { WELVURA_TASK_1_ID } from './giveaway-eligibility.mjs'

const VALID_WELVURA = '12345678'

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

function seedUser(store, telegramId, { welvuraReferral = true } = {}) {
  createUser(store, {
    id: telegramId,
    first_name: `User${telegramId}`,
    username: `u${telegramId}`,
  })
  const user = store.users[String(telegramId)]
  if (welvuraReferral) {
    user.completedTasks = [WELVURA_TASK_1_ID]
  }
  return user
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

test('Welvura ID validation', () => {
  assert.equal(isValidWelvuraId(VALID_WELVURA), true)
  assert.equal(isValidWelvuraId(` ${VALID_WELVURA} `), true)
  assert.equal(isValidWelvuraId('12ab34'), true)
  assert.equal(isValidWelvuraId('abc'), false)
  assert.equal(isValidWelvuraId(''), false)
  assert.equal(isValidWelvuraId('1'.repeat(33)), false)
})

test('rub item can withdraw; coins cannot; amount from item', async () => {
  await withTempStore(async () => {
    const created = withStore((store) => {
      const user = seedUser(store, 101)
      seedRubOpening(store, user, { openingId: 'open-rub-1', amount: 5000 })
      seedCoinOpening(store, user, 'open-coin-1')
      return createWithdrawalOnStore(store, 101, {
        itemId: 'open-rub-1',
        welvuraId: VALID_WELVURA,
        amountRub: 999999,
      })
    })
    assert.equal(created.success, true)
    assert.equal(created.withdrawal.amountRub, 5000)
    assert.equal(created.withdrawal.method, 'WELVURA')
    assert.equal(created.withdrawal.welvuraId, VALID_WELVURA)
    assert.equal(created.withdrawal.status, WITHDRAWAL_STATUS.PENDING)

    const coins = withStore((store) =>
      createWithdrawalOnStore(store, 101, {
        itemId: 'open-coin-1',
        welvuraId: VALID_WELVURA,
      }),
    )
    assert.equal(coins.success, false)
    assert.equal(coins.code, 'NOT_WITHDRAWABLE')
  })
})

test('cannot withdraw foreign item or invalid Welvura ID', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const owner = seedUser(store, 201)
      seedUser(store, 202)
      seedRubOpening(store, owner, { openingId: 'open-own', amount: 2000 })
    })

    const foreign = withStore((store) =>
      createWithdrawalOnStore(store, 202, {
        itemId: 'open-own',
        welvuraId: VALID_WELVURA,
      }),
    )
    assert.equal(foreign.success, false)
    assert.equal(foreign.code, 'ITEM_NOT_FOUND')

    const badId = withStore((store) =>
      createWithdrawalOnStore(store, 201, {
        itemId: 'open-own',
        welvuraId: 'not-a-welvura-id',
      }),
    )
    assert.equal(badId.success, false)
    assert.equal(badId.code, 'INVALID_WELVURA_ID')
  })
})

test('pending blocks double request; reject restores; approve withdraws', async () => {
  await withTempStore(async () => {
    const first = withStore((store) => {
      const user = seedUser(store, 301)
      seedRubOpening(store, user, { openingId: 'open-once', amount: 1000 })
      return createWithdrawalOnStore(store, 301, {
        itemId: 'open-once',
        welvuraId: VALID_WELVURA,
      })
    })
    assert.equal(first.success, true)
    const wdId = first.withdrawal.id

    const double = withStore((store) => {
      const a = createWithdrawalOnStore(store, 301, {
        itemId: 'open-once',
        welvuraId: VALID_WELVURA,
      })
      const b = createWithdrawalOnStore(store, 301, {
        itemId: 'open-once',
        welvuraId: VALID_WELVURA,
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

    const second = withStore((store) =>
      createWithdrawalOnStore(store, 301, {
        itemId: 'open-once',
        welvuraId: VALID_WELVURA,
      }),
    )
    assert.equal(second.success, true)

    const approved = withStore((store) => approveWithdrawalOnStore(store, second.withdrawal.id, 999))
    assert.equal(approved.success, true)
    assert.equal(approved.withdrawal.status, WITHDRAWAL_STATUS.PAID)

    const finalStatus = withStore((store) => store.users['301'].caseOpenings[0].withdrawalStatus)
    assert.equal(finalStatus, ITEM_WITHDRAWAL_STATUS.WITHDRAWN)

    const afterPaid = withStore((store) => ({
      again: createWithdrawalOnStore(store, 301, {
        itemId: 'open-once',
        welvuraId: VALID_WELVURA,
      }),
      doubleApprove: approveWithdrawalOnStore(store, second.withdrawal.id, 999),
      rejectPaid: rejectWithdrawalOnStore(store, second.withdrawal.id, 999),
    }))
    assert.equal(afterPaid.again.success, false)
    assert.equal(afterPaid.again.code, 'ALREADY_WITHDRAWN')
    assert.equal(afterPaid.doubleApprove.alreadyProcessed, true)
    assert.equal(afterPaid.rejectPaid.success, false)
  })
})

test('accepts legacy walletAddress field as Welvura ID', async () => {
  await withTempStore(async () => {
    const created = withStore((store) => {
      const user = seedUser(store, 401)
      seedRubOpening(store, user, { openingId: 'open-legacy', amount: 500 })
      return createWithdrawalOnStore(store, 401, {
        itemId: 'open-legacy',
        walletAddress: VALID_WELVURA,
      })
    })
    assert.equal(created.success, true)
    assert.equal(created.withdrawal.welvuraId, VALID_WELVURA)
    assert.equal(created.withdrawal.walletAddress, VALID_WELVURA)
  })
})

test('cannot withdraw without Welvura task-1 referral', async () => {
  await withTempStore(async () => {
    const denied = withStore((store) => {
      const user = seedUser(store, 601, { welvuraReferral: false })
      seedRubOpening(store, user, { openingId: 'open-no-ref', amount: 1000 })
      return createWithdrawalOnStore(store, 601, {
        itemId: 'open-no-ref',
        welvuraId: VALID_WELVURA,
      })
    })
    assert.equal(denied.success, false)
    assert.equal(denied.code, 'NOT_WELVURA_REFERRAL')
  })
})

test('store version includes withdrawals', () => {
  const store = createEmptyStore()
  assert.equal(store.version, 18)
  assert.ok(store.withdrawals)
})

test('withdrawal persists across store reload', async () => {
  await withTempStore(async () => {
    const created = withStore((store) => {
      const user = seedUser(store, 501)
      seedRubOpening(store, user, { openingId: 'open-persist', amount: 2000 })
      return createWithdrawalOnStore(store, 501, {
        itemId: 'open-persist',
        welvuraId: VALID_WELVURA,
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
        welvuraId: wd?.welvuraId,
      }
    })
    assert.equal(reloaded.status, WITHDRAWAL_STATUS.PENDING)
    assert.equal(reloaded.amount, 2000)
    assert.equal(reloaded.itemStatus, ITEM_WITHDRAWAL_STATUS.PENDING_WITHDRAWAL)
    assert.equal(reloaded.activeId, created.withdrawal.id)
    assert.equal(reloaded.welvuraId, VALID_WELVURA)
  })
})
