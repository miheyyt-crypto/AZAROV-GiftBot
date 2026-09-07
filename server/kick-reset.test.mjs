import assert from 'node:assert/strict'
import test from 'node:test'

import { resetAllKickBindingsOnStore } from './kick-reset.mjs'
import { linkKickAccountOnStore } from './kick-oauth.mjs'
import { recordKickFollowOnStore } from './kick-follow.mjs'
import { createEmptyStore } from './store.mjs'
import { createUser } from './users.mjs'

test('resetAllKickBindingsOnStore clears links, tokens and Kick task markers', () => {
  const store = createEmptyStore()
  createUser(store, { id: 1, first_name: 'A', username: 'a' })
  linkKickAccountOnStore(
    store,
    1,
    {
      kickUserId: '100',
      username: 'kickuser',
      displayName: 'Kick',
      avatarUrl: '',
    },
    {
      accessToken: 'secret-access',
      refreshToken: 'secret-refresh',
      expiresIn: 3600,
      scope: 'user:read',
    },
  )
  recordKickFollowOnStore(store, {
    followerKickUserId: '100',
    broadcasterUserId: '37093990',
    channelSlug: 'azarov7777',
    source: 'webhook',
  })

  assert.equal(store.users['1'].kickUserId, '100')
  assert.ok(store.users['1'].completedTasks.includes('kick-connect'))
  assert.ok(store.kickAccounts['100']?.accessToken)

  const summary = resetAllKickBindingsOnStore(store)

  assert.equal(summary.ok, true)
  assert.equal(summary.previousAccounts, 1)
  assert.deepEqual(store.kickAccounts, {})
  assert.deepEqual(store.kickByTelegram, {})
  assert.deepEqual(store.kickFollows, {})
  assert.equal(store.users['1'].kickUserId, null)
  assert.equal(store.users['1'].kickVerified, false)
  assert.equal(store.users['1'].completedTasks.includes('kick-connect'), false)
  assert.equal(Object.keys(store.events).some((key) => key.includes('kick-connect')), false)
})
