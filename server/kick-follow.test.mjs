import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { checkKickUserFollowsChannel, resolveKickChannelBySlug, _resetKickApiCaches } from './kick-api.mjs'
import {
  checkKickFollow,
  hasRecordedKickFollow,
  recordKickFollowOnStore,
} from './kick-follow.mjs'
import { linkKickAccountOnStore } from './kick-oauth.mjs'
import { createUser } from './users.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-kick-follow-'))
  const previous = process.env.AZAROV_STORE_DIR
  const prevClient = process.env.KICK_CLIENT_ID
  const prevSecret = process.env.KICK_CLIENT_SECRET
  const prevRedirect = process.env.KICK_REDIRECT_URI
  const prevChannel = process.env.KICK_REQUIRED_CHANNEL

  process.env.AZAROV_STORE_DIR = dir
  process.env.KICK_CLIENT_ID = 'test-client'
  process.env.KICK_CLIENT_SECRET = 'test-secret'
  process.env.KICK_REDIRECT_URI = 'https://example.com/api/kick/callback'
  process.env.KICK_REQUIRED_CHANNEL = 'azarov7777'

  return Promise.resolve()
    .then(() => run(dir))
    .finally(() => {
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      if (prevClient === undefined) delete process.env.KICK_CLIENT_ID
      else process.env.KICK_CLIENT_ID = prevClient
      if (prevSecret === undefined) delete process.env.KICK_CLIENT_SECRET
      else process.env.KICK_CLIENT_SECRET = prevSecret
      if (prevRedirect === undefined) delete process.env.KICK_REDIRECT_URI
      else process.env.KICK_REDIRECT_URI = prevRedirect
      if (prevChannel === undefined) delete process.env.KICK_REQUIRED_CHANNEL
      else process.env.KICK_REQUIRED_CHANNEL = prevChannel
      _resetKickApiCaches()
      rmSync(dir, { recursive: true, force: true })
    })
}

test('resolveKickChannelBySlug uses official channels API when available', async () => {
  _resetKickApiCaches()
  process.env.KICK_CLIENT_ID = 'c'
  process.env.KICK_CLIENT_SECRET = 's'

  const fetchImpl = async (url, init = {}) => {
    const target = String(url)
    if (target.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'app-token', expires_in: 3600 }),
      }
    }
    if (target.includes('/public/v1/channels')) {
      assert.match(String(init.headers?.Authorization || ''), /Bearer app-token/)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ broadcaster_user_id: 37093990, slug: 'azarov7777' }],
        }),
      }
    }
    throw new Error(`unexpected url ${target}`)
  }

  const channel = await resolveKickChannelBySlug('azarov7777', { fetchImpl })
  assert.equal(channel.broadcasterUserId, '37093990')
  assert.equal(channel.slug, 'azarov7777')
  assert.equal(channel.source, 'public_api')
})

test('checkKickUserFollowsChannel detects following from pull API', async () => {
  const channel = { slug: 'azarov7777', broadcasterUserId: '37093990' }
  const fetchImpl = async (url) => {
    const target = String(url)
    assert.match(target, /channels\/followed/)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ broadcaster_user_id: 37093990, slug: 'azarov7777' }],
      }),
    }
  }

  const result = await checkKickUserFollowsChannel('user-token', channel, { fetchImpl })
  assert.equal(result.following, true)
  assert.equal(result.mode, 'pull')
})

test('checkKickUserFollowsChannel returns not following', async () => {
  const channel = { slug: 'azarov7777', broadcasterUserId: '37093990' }
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ broadcaster_user_id: 1, slug: 'someone-else' }] }),
  })

  const result = await checkKickUserFollowsChannel('user-token', channel, { fetchImpl })
  assert.equal(result.following, false)
})

test('Kick follow task requires linked account', async () => {
  await withTempStore(async () => {
    const { withStore } = await import(`./store.mjs?t=${Date.now()}`)
    withStore((store) => {
      createUser(store, { id: 7, first_name: 'T', username: 't7' })
      return true
    })

    const result = await checkKickFollow(7, 'req-1', {
      fetchImpl: async () => {
        throw new Error('should_not_call_kick')
      },
    })

    assert.equal(result.success, false)
    assert.equal(result.following, false)
    assert.equal(result.code, 'KICK_NOT_CONNECTED')
  })
})

test('Kick follow task grants reward once when pull confirms follow', async () => {
  await withTempStore(async () => {
    const { withStore } = await import(`./store.mjs?t=${Date.now() + 1}`)
    withStore((store) => {
      createUser(store, { id: 11, first_name: 'A', username: 'a11' })
      linkKickAccountOnStore(
        store,
        11,
        {
          kickUserId: '900',
          username: 'fan',
          displayName: 'Fan',
          avatarUrl: '',
        },
        {
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresIn: 3600,
          scope: 'user:read channel:read',
        },
      )
      return true
    })

    const fetchImpl = async (url) => {
      const target = String(url)
      if (target.includes('/oauth/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'app-token', expires_in: 3600 }),
        }
      }
      if (target.includes('/public/v1/channels?') || target.includes('/public/v1/channels&')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ broadcaster_user_id: 37093990, slug: 'azarov7777' }],
          }),
        }
      }
      if (target.includes('/public/v1/channels') && !target.includes('followed')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ broadcaster_user_id: 37093990, slug: 'azarov7777' }],
          }),
        }
      }
      if (target.includes('channels/followed')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ broadcaster_user_id: 37093990, slug: 'azarov7777' }],
          }),
        }
      }
      throw new Error(`unexpected ${target}`)
    }

    const first = await checkKickFollow(11, 'req-follow-1', { fetchImpl })
    assert.equal(first.success, true)
    assert.equal(first.completed, true)
    assert.equal(first.following, true)
    assert.equal(first.rewarded, true)
    assert.equal(first.reward, 500)

    const second = await checkKickFollow(11, 'req-follow-2', { fetchImpl })
    assert.equal(second.success, true)
    assert.equal(second.alreadyCompleted, true)
    assert.equal(second.rewarded, false)
  })
})

test('Kick follow task rejects when user is not following', async () => {
  await withTempStore(async () => {
    const { withStore } = await import(`./store.mjs?t=${Date.now() + 2}`)
    withStore((store) => {
      createUser(store, { id: 12, first_name: 'B', username: 'b12' })
      linkKickAccountOnStore(
        store,
        12,
        {
          kickUserId: '901',
          username: 'nofan',
          displayName: 'NoFan',
          avatarUrl: '',
        },
        {
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresIn: 3600,
          scope: 'user:read channel:read',
        },
      )
      return true
    })

    const fetchImpl = async (url) => {
      const target = String(url)
      if (target.includes('/oauth/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'app-token', expires_in: 3600 }),
        }
      }
      if (target.includes('/public/v1/channels') && !target.includes('followed')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ broadcaster_user_id: 37093990, slug: 'azarov7777' }],
          }),
        }
      }
      if (target.includes('channels/followed')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        }
      }
      throw new Error(`unexpected ${target}`)
    }

    const result = await checkKickFollow(12, 'req-nofollow', { fetchImpl })
    assert.equal(result.success, false)
    assert.equal(result.following, false)
    assert.equal(result.code, 'NOT_FOLLOWING')
  })
})

test('webhook-recorded follow can complete task without pull API', async () => {
  await withTempStore(async () => {
    const { withStore } = await import(`./store.mjs?t=${Date.now() + 3}`)
    withStore((store) => {
      createUser(store, { id: 13, first_name: 'C', username: 'c13' })
      linkKickAccountOnStore(store, 13, {
        kickUserId: '902',
        username: 'hookfan',
        displayName: 'HookFan',
        avatarUrl: '',
      })
      recordKickFollowOnStore(store, {
        followerKickUserId: '902',
        broadcasterUserId: '37093990',
        channelSlug: 'azarov7777',
        source: 'webhook',
      })
      assert.equal(hasRecordedKickFollow(store, '902', '37093990'), true)
      return true
    })

    const fetchImpl = async (url) => {
      const target = String(url)
      if (target.includes('/oauth/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'app-token', expires_in: 3600 }),
        }
      }
      if (target.includes('/public/v1/channels') && !target.includes('followed')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ broadcaster_user_id: 37093990, slug: 'azarov7777' }],
          }),
        }
      }
      throw new Error(`pull should not be required when webhook evidence exists: ${target}`)
    }

    const result = await checkKickFollow(13, 'req-webhook', { fetchImpl })
    assert.equal(result.success, true)
    assert.equal(result.following, true)
    assert.equal(result.completed, true)
  })
})
