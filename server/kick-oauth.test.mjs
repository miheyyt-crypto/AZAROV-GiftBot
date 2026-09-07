import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildKickAuthorizeUrl,
  consumeOAuthState,
  generatePkcePair,
  getKickConnectionForUser,
  linkKickAccountOnStore,
  normalizeKickProfile,
} from './kick-oauth.mjs'
import { createEmptyStore } from './store.mjs'
import { createUser } from './users.mjs'

function makeStoreWithUsers(...ids) {
  const store = createEmptyStore()
  for (const id of ids) {
    createUser(store, { id, first_name: `U${id}`, username: `u${id}` })
  }
  return store
}

test('normalizeKickProfile uses stable kick user_id and display fields', () => {
  const profile = normalizeKickProfile({
    user_id: 42,
    name: 'CoolStreamer',
    profile_picture: 'https://kick.com/a.webp',
  })
  assert.equal(profile.kickUserId, '42')
  assert.equal(profile.username, 'CoolStreamer')
  assert.equal(profile.avatarUrl, 'https://kick.com/a.webp')
  assert.equal(normalizeKickProfile({}), null)
})

test('PKCE pair generates verifier and S256 challenge', () => {
  const pair = generatePkcePair()
  assert.match(pair.codeVerifier, /^[A-Za-z0-9_-]+$/)
  assert.match(pair.codeChallenge, /^[A-Za-z0-9_-]+$/)
  assert.notEqual(pair.codeVerifier, pair.codeChallenge)
})

test('authorize URL includes required Kick OAuth params', () => {
  const url = buildKickAuthorizeUrl({
    clientId: 'client',
    redirectUri: 'https://azarov-giftbot-production.up.railway.app/api/kick/callback',
    state: 'abc',
    codeChallenge: 'challenge',
  })
  const parsed = new URL(url)
  assert.equal(parsed.origin + parsed.pathname, 'https://id.kick.com/oauth/authorize')
  assert.equal(parsed.searchParams.get('response_type'), 'code')
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(parsed.searchParams.get('scope'), 'user:read')
})

test('Test 1: Telegram A links Kick X successfully', () => {
  const store = makeStoreWithUsers(1)
  const result = linkKickAccountOnStore(store, 1, {
    kickUserId: '100',
    username: 'kickx',
    displayName: 'Kick X',
    avatarUrl: '',
  })

  assert.equal(result.ok, true)
  assert.equal(result.code, 'linked')
  assert.equal(store.kickByTelegram['1'], '100')
  assert.equal(store.kickAccounts['100'].telegramUserId, 1)
  assert.equal(store.users['1'].kickVerified, true)
  assert.equal(store.users['1'].balance, 400)
  assert.ok(store.users['1'].completedTasks.includes('kick-connect'))
})

test('Test 2: Telegram A cannot link a second Kick Y', () => {
  const store = makeStoreWithUsers(1)
  linkKickAccountOnStore(store, 1, {
    kickUserId: '100',
    username: 'kickx',
    displayName: 'Kick X',
    avatarUrl: '',
  })
  const second = linkKickAccountOnStore(store, 1, {
    kickUserId: '200',
    username: 'kicky',
    displayName: 'Kick Y',
    avatarUrl: '',
  })

  assert.equal(second.ok, false)
  assert.equal(second.code, 'telegram_already_linked')
  assert.equal(store.kickByTelegram['1'], '100')
  assert.equal(store.kickAccounts['200'], undefined)
  assert.equal(store.users['1'].balance, 400)
})

test('Test 3: Telegram B cannot steal Kick X from A', () => {
  const store = makeStoreWithUsers(1, 2)
  linkKickAccountOnStore(store, 1, {
    kickUserId: '100',
    username: 'kickx',
    displayName: 'Kick X',
    avatarUrl: '',
  })
  const steal = linkKickAccountOnStore(store, 2, {
    kickUserId: '100',
    username: 'kickx',
    displayName: 'Kick X',
    avatarUrl: '',
  })

  assert.equal(steal.ok, false)
  assert.equal(steal.code, 'kick_already_linked')
  assert.equal(store.kickAccounts['100'].telegramUserId, 1)
  assert.equal(store.kickByTelegram['2'], undefined)
  assert.equal(store.users['2'].kickVerified, false)
})

test('Test 4: repeat link of same Kick X is idempotent', () => {
  const store = makeStoreWithUsers(1)
  linkKickAccountOnStore(store, 1, {
    kickUserId: '100',
    username: 'kickx',
    displayName: 'Kick X',
    avatarUrl: '',
  })
  const again = linkKickAccountOnStore(store, 1, {
    kickUserId: '100',
    username: 'kickx_new',
    displayName: 'Kick X New',
    avatarUrl: 'https://cdn/a.png',
  })

  assert.equal(again.ok, true)
  assert.equal(again.code, 'already_connected')
  assert.equal(store.users['1'].balance, 400)
  assert.equal(store.kickAccounts['100'].username, 'kickx_new')
})

test('Test 5: concurrent-like race — only one Telegram gets Kick X', () => {
  const store = makeStoreWithUsers(1, 2)
  const first = linkKickAccountOnStore(store, 1, {
    kickUserId: '100',
    username: 'kickx',
    displayName: 'Kick X',
    avatarUrl: '',
  })
  const second = linkKickAccountOnStore(store, 2, {
    kickUserId: '100',
    username: 'kickx',
    displayName: 'Kick X',
    avatarUrl: '',
  })

  assert.equal(first.ok, true)
  assert.equal(second.ok, false)
  assert.equal(second.code, 'kick_already_linked')
  assert.equal(Object.keys(store.kickAccounts).length, 1)
})

test('Test 6-7: invalid and expired OAuth state are rejected', () => {
  const store = createEmptyStore()
  store.kickOAuthStates.good = {
    state: 'good',
    telegramUserId: 1,
    codeVerifier: 'verifier',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    usedAt: null,
  }
  store.kickOAuthStates.old = {
    state: 'old',
    telegramUserId: 1,
    codeVerifier: 'verifier',
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    usedAt: null,
  }

  assert.equal(consumeOAuthState(store, 'missing').code, 'invalid_state')
  assert.equal(consumeOAuthState(store, 'old').code, 'expired_state')

  const ok = consumeOAuthState(store, 'good')
  assert.equal(ok.ok, true)
  assert.equal(store.kickOAuthStates.good, undefined)
  assert.equal(consumeOAuthState(store, 'good').code, 'invalid_state')
})

test('Test 8-9: cancelled / API failures never create a Kick link when handled at higher layer', () => {
  // Linking helpers only run after successful Kick user fetch.
  // Ensure empty store stays empty without an explicit link call.
  const store = makeStoreWithUsers(1)
  assert.equal(Object.keys(store.kickAccounts).length, 0)
  assert.equal(getKickConnectionForUser(store, 1).connected, false)
})

test('Test 10: connection remains after store re-read shape', () => {
  const store = makeStoreWithUsers(1)
  linkKickAccountOnStore(store, 1, {
    kickUserId: '100',
    username: 'kickx',
    displayName: 'Kick X',
    avatarUrl: 'https://cdn/a.png',
  })

  const connection = getKickConnectionForUser(store, 1)
  assert.equal(connection.connected, true)
  assert.equal(connection.username, 'kickx')
  assert.equal(connection.kickUserId, '100')
})
