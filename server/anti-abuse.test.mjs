import assert from 'node:assert/strict'
import test from 'node:test'

import {
  enforceAntiAbuseOnStore,
  isMultiAccountCheckEnabled,
  peekRegistrationSignals,
  unbanAllBlockedUsersOnStore,
  userCanUseAppEconomy,
} from './anti-abuse.mjs'
import { createEmptyStore } from './store.mjs'

test('ban system is disabled', () => {
  assert.equal(isMultiAccountCheckEnabled(), false)
  const peek = peekRegistrationSignals()
  assert.equal(peek.ok, true)
})

test('economy always allowed for existing user', () => {
  const gate = userCanUseAppEconomy({ telegramId: 1, blocked: true, antiAbuseBound: false })
  assert.equal(gate.ok, true)
})

test('enforce never blocks', () => {
  const store = createEmptyStore()
  const user = { telegramId: 1, blocked: true, antiAbuseBound: false }
  const result = enforceAntiAbuseOnStore(store, user)
  assert.equal(result.allowed, true)
  assert.equal(user.blocked, false)
  assert.equal(user.antiAbuseBound, true)
})

test('unbanAll clears historical bans', () => {
  const store = createEmptyStore()
  store.users['1'] = {
    telegramId: 1,
    blocked: true,
    blockReason: 'MULTI_ACCOUNT',
    blockedAt: new Date().toISOString(),
    antiAbuseBound: true,
  }
  store.deviceIndex = { 'x': { telegramId: 1 } }
  const summary = unbanAllBlockedUsersOnStore(store)
  assert.equal(summary.unbannedCount, 1)
  assert.equal(store.users['1'].blocked, false)
  assert.deepEqual(store.deviceIndex, {})
})

test('createEmptyStore is v19', () => {
  assert.equal(createEmptyStore().version, 23)
})
