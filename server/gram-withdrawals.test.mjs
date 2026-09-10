import assert from 'node:assert/strict'
import test from 'node:test'

import { MIN_GRAM_WITHDRAWAL, roundGram } from './gram.mjs'
import { createEmptyStore, withStore } from './store.mjs'
import { createUser } from './users.mjs'
import {
  createGramWithdrawalOnStore,
  rejectWithdrawalOnStore,
} from './withdrawals.mjs'

function seedUser(telegramId, gramBalance = 0) {
  return withStore((store) => {
    Object.assign(store, createEmptyStore())
    const user = createUser(store, {
      id: telegramId,
      username: `gram_${telegramId}`,
      first_name: 'Gram',
    })
    user.gramBalance = roundGram(gramBalance)
    return user.telegramId
  })
}

test('gram withdrawal rejects below minimum', () => {
  const userId = seedUser(91001, 19.999)
  const result = withStore((store) =>
    createGramWithdrawalOnStore(store, userId, { amount: 19.999, requestId: 'g1' }),
  )
  assert.equal(result.success, false)
  assert.equal(result.code, 'BELOW_MINIMUM')
  withStore((store) => {
    assert.equal(roundGram(store.users[String(userId)].gramBalance), 19.999)
  })
})

test('gram withdrawal rejects amount above balance', () => {
  const userId = seedUser(91002, 25)
  const result = withStore((store) =>
    createGramWithdrawalOnStore(store, userId, { amount: 30, requestId: 'g2' }),
  )
  assert.equal(result.success, false)
  assert.equal(result.code, 'INSUFFICIENT_BALANCE')
})

test('gram withdrawal succeeds at minimum and deducts atomically', () => {
  const userId = seedUser(91003, 20)
  const result = withStore((store) =>
    createGramWithdrawalOnStore(store, userId, {
      amount: MIN_GRAM_WITHDRAWAL,
      requestId: 'g3',
    }),
  )
  assert.equal(result.success, true)
  assert.equal(result.withdrawal.currency, 'GRAM')
  assert.equal(result.withdrawal.amountGram, 20)
  withStore((store) => {
    assert.equal(roundGram(store.users[String(userId)].gramBalance), 0)
  })
})

test('gram withdrawal same requestId is idempotent', () => {
  const userId = seedUser(91004, 40)
  const first = withStore((store) =>
    createGramWithdrawalOnStore(store, userId, { amount: 20, requestId: 'g-idem' }),
  )
  const again = withStore((store) =>
    createGramWithdrawalOnStore(store, userId, { amount: 20, requestId: 'g-idem' }),
  )
  assert.equal(first.success, true)
  assert.equal(again.success, true)
  assert.equal(again.alreadyProcessed, true)
  assert.equal(again.withdrawal.id, first.withdrawal.id)
  withStore((store) => {
    assert.equal(roundGram(store.users[String(userId)].gramBalance), 20)
  })
})

test('two sequential withdrawals cannot overdraw the same balance', () => {
  const userId = seedUser(91005, 20)
  const a = withStore((store) =>
    createGramWithdrawalOnStore(store, userId, { amount: 20, requestId: 'g-a' }),
  )
  const b = withStore((store) =>
    createGramWithdrawalOnStore(store, userId, { amount: 20, requestId: 'g-b' }),
  )
  assert.equal(a.success, true)
  assert.equal(b.success, false)
  assert.equal(b.code, 'BELOW_MINIMUM')
})

test('reject refunds gram balance', () => {
  const userId = seedUser(91006, 25.5)
  const created = withStore((store) =>
    createGramWithdrawalOnStore(store, userId, { amount: 20.5, requestId: 'g-ref' }),
  )
  assert.equal(created.success, true)
  withStore((store) => {
    assert.equal(roundGram(store.users[String(userId)].gramBalance), 5)
    const rejected = rejectWithdrawalOnStore(store, created.withdrawal.id, 1)
    assert.equal(rejected.success, true)
    assert.equal(roundGram(store.users[String(userId)].gramBalance), 25.5)
  })
})
