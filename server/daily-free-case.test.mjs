import assert from 'node:assert/strict'
import test from 'node:test'

import { openDailyFreeCase, getDailyFreeCaseStatus, DAILY_FREE_CASE_COOLDOWN_MS } from './daily-free-case.mjs'
import { createEmptyStore, withStore } from './store.mjs'
import { createUser } from './users.mjs'

function seedUser(telegramId = 88001) {
  return withStore((store) => {
    Object.assign(store, createEmptyStore())
    const user = createUser(store, {
      id: telegramId,
      username: 'daily_case_user',
      first_name: 'Daily',
    })
    return user.telegramId
  })
}

test('daily free case: first open credits once and starts cooldown', () => {
  const userId = seedUser(88011)
  const first = openDailyFreeCase(userId, 'dfc-req-0001')
  assert.equal(first.success, true)
  assert.ok(first.reward?.amount >= 1)
  assert.equal(first.available, false)
  assert.ok(first.availableAt)

  const status = getDailyFreeCaseStatus(userId)
  assert.equal(status.available, false)
  assert.equal(status.user.balance, first.reward.amount)
  assert.equal(status.user.dailyFreeCaseAvailable, false)
})

test('daily free case: same requestId is idempotent', () => {
  const userId = seedUser(88012)
  const first = openDailyFreeCase(userId, 'dfc-req-idem-1')
  const again = openDailyFreeCase(userId, 'dfc-req-idem-1')
  assert.equal(first.success, true)
  assert.equal(again.success, true)
  assert.equal(again.alreadyProcessed, true)
  assert.equal(again.reward.id, first.reward.id)
  assert.equal(again.user.balance, first.reward.amount)
})

test('daily free case: second open during cooldown is rejected', () => {
  const userId = seedUser(88013)
  const first = openDailyFreeCase(userId, 'dfc-req-cool-1')
  assert.equal(first.success, true)

  const second = openDailyFreeCase(userId, 'dfc-req-cool-2')
  assert.equal(second.success, false)
  assert.equal(second.code, 'COOLDOWN')
  assert.equal(second.user.balance, first.reward.amount)
})

test('daily free case: available again after 24h', () => {
  const userId = seedUser(88014)
  const first = openDailyFreeCase(userId, 'dfc-req-day-1')
  assert.equal(first.success, true)

  withStore((store) => {
    const user = store.users[String(userId)]
    user.lastDailyFreeCaseAt = new Date(Date.now() - DAILY_FREE_CASE_COOLDOWN_MS - 1000).toISOString()
  })

  const status = getDailyFreeCaseStatus(userId)
  assert.equal(status.available, true)
  assert.equal(status.user.dailyFreeCaseAvailable, true)

  const second = openDailyFreeCase(userId, 'dfc-req-day-2')
  assert.equal(second.success, true)
  assert.equal(second.user.balance, first.reward.amount + second.reward.amount)
})
