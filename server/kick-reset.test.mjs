import assert from 'node:assert/strict'
import test from 'node:test'

import { resetAllKickBindingsOnStore, unlinkKickForUserOnStore } from './kick-reset.mjs'
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

test('unlinkKickForUserOnStore unlinks one user by username', () => {
  const store = createEmptyStore()
  createUser(store, { id: 10, first_name: 'L', username: 'lamkustg' })
  createUser(store, { id: 11, first_name: 'O', username: 'other' })
  linkKickAccountOnStore(store, 10, {
    kickUserId: '200',
    username: 'kick_lam',
    displayName: 'Lam',
    avatarUrl: '',
  })
  linkKickAccountOnStore(store, 11, {
    kickUserId: '201',
    username: 'kick_other',
    displayName: 'Other',
    avatarUrl: '',
  })

  const summary = unlinkKickForUserOnStore(store, { username: '@lamkustg' })
  assert.equal(summary.ok, true)
  assert.equal(summary.unlinked, true)
  assert.equal(summary.telegramId, 10)
  assert.equal(store.users['10'].kickUserId, null)
  assert.equal(store.kickByTelegram['10'], undefined)
  assert.equal(store.kickAccounts['200'], undefined)
  // Other user stays linked
  assert.equal(store.users['11'].kickUserId, '201')
  assert.equal(store.kickByTelegram['11'], '201')
})
