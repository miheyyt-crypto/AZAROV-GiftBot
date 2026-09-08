import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { KICK_API_USERS_URL, KICK_NICKNAME_TASK_ID, KICK_NICKNAME_TASK_REWARD } from './constants.mjs'
import { linkKickAccountOnStore } from './kick-oauth.mjs'
import { checkKickNickname, kickNicknameMatches } from './kick-nickname.mjs'
import { withStore } from './store.mjs'
import { createUser } from './users.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-kick-nick-'))
  const previous = process.env.AZAROV_STORE_DIR
  const prevClient = process.env.KICK_CLIENT_ID
  const prevSecret = process.env.KICK_CLIENT_SECRET
  const prevRedirect = process.env.KICK_REDIRECT_URI
  const prevTag = process.env.KICK_NICKNAME_TAG

  process.env.AZAROV_STORE_DIR = dir
  process.env.KICK_CLIENT_ID = 'test-client'
  process.env.KICK_CLIENT_SECRET = 'test-secret'
  process.env.KICK_REDIRECT_URI = 'https://example.com/api/kick/callback'
  process.env.KICK_NICKNAME_TAG = 'AZAROV'

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      if (prevClient === undefined) delete process.env.KICK_CLIENT_ID
      else process.env.KICK_CLIENT_ID = prevClient
      if (prevSecret === undefined) delete process.env.KICK_CLIENT_SECRET
      else process.env.KICK_CLIENT_SECRET = prevSecret
      if (prevRedirect === undefined) delete process.env.KICK_REDIRECT_URI
      else process.env.KICK_REDIRECT_URI = prevRedirect
      if (prevTag === undefined) delete process.env.KICK_NICKNAME_TAG
      else process.env.KICK_NICKNAME_TAG = prevTag
      rmSync(dir, { recursive: true, force: true })
    })
}

function linkUser(store, telegramId, kickUserId, username = 'viewer') {
  createUser(store, { id: telegramId, first_name: 'U', username: `u${telegramId}` })
  linkKickAccountOnStore(
    store,
    telegramId,
    {
      kickUserId: String(kickUserId),
      username,
      displayName: username,
      avatarUrl: '',
    },
    {
      accessToken: 'tok',
      refreshToken: 'ref',
      expiresIn: 3600,
      scope: 'user:read channel:read',
    },
  )
}

function usersFetchImpl(profile) {
  return async (url) => {
    const target = String(url)
    if (target.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'fresh', expires_in: 3600, refresh_token: 'ref' }),
      }
    }
    if (target === KICK_API_USERS_URL || target.includes('/public/v1/users')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [profile] }),
      }
    }
    throw new Error(`unexpected url ${target}`)
  }
}

test('kickNicknameMatches checks username and displayName', () => {
  assert.equal(kickNicknameMatches({ username: 'x_AZAROV_y', displayName: 'x' }, 'AZAROV'), true)
  assert.equal(kickNicknameMatches({ username: 'plain', displayName: 'fan AZAROV' }, 'AZAROV'), true)
  assert.equal(kickNicknameMatches({ username: 'plain', displayName: 'plain' }, 'AZAROV'), false)
})

test('checkKickNickname grants reward once when tag present', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 41, '7401', 'plain')
      return true
    })

    const fetchImpl = usersFetchImpl({
      user_id: 7401,
      username: 'fan_AZAROV',
      name: 'Fan',
    })

    const balanceAfterLink = withStore((store) => store.users['41'].balance)

    const first = await checkKickNickname(41, 'nick-req-1', { fetchImpl })
    assert.equal(first.success, true)
    assert.equal(first.rewarded, true)
    assert.equal(first.reward, KICK_NICKNAME_TASK_REWARD)

    withStore((store) => {
      assert.equal(store.users['41'].balance, balanceAfterLink + KICK_NICKNAME_TASK_REWARD)
      assert.ok(store.users['41'].completedTasks.includes(KICK_NICKNAME_TASK_ID))
      return true
    })

    const second = await checkKickNickname(41, 'nick-req-2', { fetchImpl })
    assert.equal(second.success, true)
    assert.equal(second.alreadyCompleted, true)
    assert.equal(second.rewarded, false)

    withStore((store) => {
      assert.equal(store.users['41'].balance, balanceAfterLink + KICK_NICKNAME_TASK_REWARD)
      return true
    })
  })
})

test('checkKickNickname rejects missing tag without rewarding', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 42, '7402', 'plain')
      return true
    })

    const balanceAfterLink = withStore((store) => store.users['42'].balance)

    const result = await checkKickNickname(42, 'nick-miss', {
      fetchImpl: usersFetchImpl({ user_id: 7402, username: 'plain', name: 'Plain' }),
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'NICKNAME_TAG_MISSING')
    withStore((store) => {
      assert.equal(store.users['42'].balance, balanceAfterLink)
      assert.equal(store.users['42'].completedTasks.includes(KICK_NICKNAME_TASK_ID), false)
      return true
    })
  })
})

test('checkKickNickname requires linked Kick', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      createUser(store, { id: 43, first_name: 'N', username: 'n43' })
      return true
    })

    const result = await checkKickNickname(43, 'nick-unlink', {
      fetchImpl: usersFetchImpl({ user_id: 1, username: 'AZAROV', name: 'A' }),
    })
    assert.equal(result.success, false)
    assert.equal(result.code, 'KICK_NOT_CONNECTED')
  })
})
