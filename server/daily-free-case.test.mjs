import assert from 'node:assert/strict'
import test from 'node:test'

import {
  openDailyFreeCase,
  getDailyFreeCaseStatus,
  DAILY_FREE_CASE_COOLDOWN_MS,
} from './daily-free-case.mjs'
import {
  getDailyFreeCaseRewardsFlat,
  getDailyFreeCaseRequirements,
  listDailyFreeCaseRarities,
  rollDailyFreeCaseReward,
} from './daily-free-case-config.mjs'
import { TELEGRAM_SUBSCRIBE_TASK_ID } from './constants.mjs'
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

function unlockFreeCaseGates(telegramId) {
  withStore((store) => {
    const user = store.users[String(telegramId)]
    user.kickVerified = true
    user.kickUserId = `kick-${telegramId}`
    user.completedTasks = [
      ...new Set([...(user.completedTasks || []), TELEGRAM_SUBSCRIBE_TASK_ID]),
    ]
  })
}

test('daily free case config has 16 rewards across 3 rarities', () => {
  const rarities = listDailyFreeCaseRarities()
  assert.equal(rarities.length, 3)
  assert.equal(rarities[0].chance, 1)
  assert.equal(rarities[1].chance, 15)
  assert.equal(rarities[2].chance, 50)
  assert.equal(rarities[0].rollWeight, 1)
  assert.equal(rarities[1].rollWeight, 100)
  assert.equal(rarities[2].rollWeight, 999_899)
  assert.equal(
    rarities.reduce((sum, item) => sum + item.rollWeight, 0),
    1_000_000,
  )
  assert.equal(rarities[0].rewards.length, 6)
  assert.equal(rarities[1].rewards.length, 4)
  assert.equal(rarities[2].rewards.length, 6)
  assert.equal(getDailyFreeCaseRewardsFlat().length, 16)
})

test('daily free case roll returns known reward ids', () => {
  const ids = new Set(getDailyFreeCaseRewardsFlat().map((item) => item.id))
  for (let i = 0; i < 40; i += 1) {
    const reward = rollDailyFreeCaseReward(() => Math.random())
    assert.ok(ids.has(reward.id))
    assert.ok(['legendary', 'epic', 'common'].includes(reward.rarity))
  }
})

test('daily free case: first open credits once and starts cooldown', () => {
  const userId = seedUser(88011)
  unlockFreeCaseGates(userId)
  const first = openDailyFreeCase(userId, 'dfc-req-0001')
  assert.equal(first.success, true)
  assert.ok(first.reward?.id)
  assert.equal(first.available, false)
  assert.ok(first.availableAt)

  const status = getDailyFreeCaseStatus(userId)
  assert.equal(status.available, false)
  assert.equal(status.canOpen, false)
})

test('daily free case: same requestId is idempotent', () => {
  const userId = seedUser(88012)
  unlockFreeCaseGates(userId)
  const first = openDailyFreeCase(userId, 'dfc-req-idem-1')
  const again = openDailyFreeCase(userId, 'dfc-req-idem-1')
  assert.equal(first.success, true)
  assert.equal(again.success, true)
  assert.equal(again.alreadyProcessed, true)
  assert.equal(again.reward.id, first.reward.id)
})

test('daily free case: second open during cooldown is rejected', () => {
  const userId = seedUser(88013)
  unlockFreeCaseGates(userId)
  const first = openDailyFreeCase(userId, 'dfc-req-cool-1')
  assert.equal(first.success, true)

  const second = openDailyFreeCase(userId, 'dfc-req-cool-2')
  assert.equal(second.success, false)
  assert.equal(second.code, 'COOLDOWN')
})

test('daily free case: available again after 24h', () => {
  const userId = seedUser(88014)
  unlockFreeCaseGates(userId)
  const first = openDailyFreeCase(userId, 'dfc-req-day-1')
  assert.equal(first.success, true)

  withStore((store) => {
    const user = store.users[String(userId)]
    user.lastDailyFreeCaseAt = new Date(Date.now() - DAILY_FREE_CASE_COOLDOWN_MS - 1000).toISOString()
  })

  const status = getDailyFreeCaseStatus(userId)
  assert.equal(status.available, true)
  assert.equal(status.canOpen, true)
  assert.equal(status.user.dailyFreeCaseAvailable, true)
  assert.equal(status.user.freeCase.canOpen, true)

  const second = openDailyFreeCase(userId, 'dfc-req-day-2')
  assert.equal(second.success, true)
})

test('daily free case: rejects without Kick', () => {
  const userId = seedUser(88021)
  withStore((store) => {
    const user = store.users[String(userId)]
    user.completedTasks = [TELEGRAM_SUBSCRIBE_TASK_ID]
  })
  const result = openDailyFreeCase(userId, 'dfc-no-kick')
  assert.equal(result.success, false)
  assert.equal(result.code, 'KICK_NOT_LINKED')
  assert.equal(result.canOpen, false)
  assert.equal(result.requirements.kickLinked, false)
  assert.equal(result.requirements.telegramTaskCompleted, true)
})

test('daily free case: rejects without telegram subscribe task', () => {
  const userId = seedUser(88022)
  withStore((store) => {
    const user = store.users[String(userId)]
    user.kickVerified = true
    user.kickUserId = 'kick-88022'
  })
  const result = openDailyFreeCase(userId, 'dfc-no-tg')
  assert.equal(result.success, false)
  assert.equal(result.code, 'TELEGRAM_TASK_NOT_COMPLETED')
  assert.equal(result.requirements.kickLinked, true)
  assert.equal(result.requirements.telegramTaskCompleted, false)
})

test('daily free case: rejects when both requirements missing', () => {
  const userId = seedUser(88023)
  const result = openDailyFreeCase(userId, 'dfc-no-both')
  assert.equal(result.success, false)
  assert.equal(result.code, 'REQUIREMENTS_NOT_MET')
  const requirements = getDailyFreeCaseRequirements(result.user || { completedTasks: [] })
  assert.equal(result.requirements.canOpen, false)
  assert.equal(requirements.kickLinked, false)
})
