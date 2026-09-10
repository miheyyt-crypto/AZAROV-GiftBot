import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getOnlineCount,
  listOnlineUsers,
  PRESENCE_ONLINE_TTL_MS,
  resetPresenceForTests,
  touchPresence,
} from './presence.mjs'

test('presence counts only fresh heartbeats', () => {
  resetPresenceForTests()
  const now = Date.now()
  touchPresence(101, { username: 'a' }, now)
  touchPresence(102, { username: 'b' }, now)
  assert.equal(getOnlineCount(now), 2)

  assert.equal(getOnlineCount(now + PRESENCE_ONLINE_TTL_MS + 1), 0)
})

test('touchPresence refreshes expiry for same user', () => {
  resetPresenceForTests()
  const t0 = Date.now()
  touchPresence(201, { username: 'same' }, t0)
  touchPresence(201, { username: 'same' }, t0 + PRESENCE_ONLINE_TTL_MS - 1_000)
  assert.equal(getOnlineCount(t0 + PRESENCE_ONLINE_TTL_MS + 500), 1)
  assert.equal(listOnlineUsers(t0 + PRESENCE_ONLINE_TTL_MS + 500).length, 1)
})

test('invalid telegram id is ignored', () => {
  resetPresenceForTests()
  assert.equal(touchPresence('nope').success, false)
  assert.equal(getOnlineCount(), 0)
})
