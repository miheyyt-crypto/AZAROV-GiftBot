import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  buildKickLiveStartedMessageHtml,
  evaluateKickLiveNotifyTransition,
  kickLiveNotifyEventKey,
  planKickLiveStartedNotifyOnStore,
  resetKickLiveNotifyBootstrapForTests,
  resolveKickLiveStreamKey,
  sendKickLiveStartedTelegram,
  unclaimKickLiveNotify,
} from './kick-live-notify.mjs'
import { hasKickWebhookEvent, processLivestreamStatusUpdated } from './kick-streak.mjs'
import { createEmptyStore, withStore } from './store.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-kick-live-notify-'))
  const previous = process.env.AZAROV_STORE_DIR
  const prevChat = process.env.KICK_NOTIFICATION_CHAT_ID
  const prevToken = process.env.BOT_TOKEN
  const prevClient = process.env.KICK_CLIENT_ID
  const prevSecret = process.env.KICK_CLIENT_SECRET
  const prevRedirect = process.env.KICK_REDIRECT_URI
  const prevChannel = process.env.KICK_REQUIRED_CHANNEL
  process.env.AZAROV_STORE_DIR = dir
  process.env.KICK_NOTIFICATION_CHAT_ID = '-100111'
  process.env.BOT_TOKEN = 'test-token'
  process.env.KICK_CLIENT_ID = 'test-client'
  process.env.KICK_CLIENT_SECRET = 'test-secret'
  process.env.KICK_REDIRECT_URI = 'https://example.com/api/kick/callback'
  process.env.KICK_REQUIRED_CHANNEL = 'azarov7777'
  resetKickLiveNotifyBootstrapForTests()
  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      if (prevChat === undefined) delete process.env.KICK_NOTIFICATION_CHAT_ID
      else process.env.KICK_NOTIFICATION_CHAT_ID = prevChat
      if (prevToken === undefined) delete process.env.BOT_TOKEN
      else process.env.BOT_TOKEN = prevToken
      if (prevClient === undefined) delete process.env.KICK_CLIENT_ID
      else process.env.KICK_CLIENT_ID = prevClient
      if (prevSecret === undefined) delete process.env.KICK_CLIENT_SECRET
      else process.env.KICK_CLIENT_SECRET = prevSecret
      if (prevRedirect === undefined) delete process.env.KICK_REDIRECT_URI
      else process.env.KICK_REDIRECT_URI = prevRedirect
      if (prevChannel === undefined) delete process.env.KICK_REQUIRED_CHANNEL
      else process.env.KICK_REQUIRED_CHANNEL = prevChannel
      resetKickLiveNotifyBootstrapForTests()
      rmSync(dir, { recursive: true, force: true })
    })
}

function liveFetchImpl() {
  return async (url) => {
    const href = String(url)
    if (href.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'app-token', expires_in: 3600 }),
      }
    }
    if (href.includes('/public/v1/channels')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ slug: 'azarov7777', broadcaster_user_id: 37093990 }],
        }),
      }
    }
    if (href.includes('api.telegram.org')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
      }
    }
    if (href.includes('kick.com/api/v2/channels')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ slug: 'azarov7777', user_id: 37093990, id: 1 }),
      }
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) }
  }
}

function failingTelegramFetchImpl() {
  return async (url) => {
    const href = String(url)
    if (href.includes('api.telegram.org')) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ ok: false, description: 'boom' }),
      }
    }
    return liveFetchImpl()(url)
  }
}

test('evaluate: offline → live notifies', () => {
  const result = evaluateKickLiveNotifyTransition({
    bootstrapped: true,
    previousIsLive: false,
    nextIsLive: true,
    streamKey: 's1',
    alreadyNotified: false,
  })
  assert.equal(result.action, 'notify')
})

test('evaluate: live → live does not notify', () => {
  const result = evaluateKickLiveNotifyTransition({
    bootstrapped: true,
    previousIsLive: true,
    nextIsLive: true,
    streamKey: 's1',
    alreadyNotified: false,
  })
  assert.equal(result.action, 'none')
  assert.equal(result.reason, 'still_live')
})

test('evaluate: live → offline does not notify', () => {
  const result = evaluateKickLiveNotifyTransition({
    bootstrapped: true,
    previousIsLive: true,
    nextIsLive: false,
    streamKey: 's1',
    alreadyNotified: false,
  })
  assert.equal(result.action, 'none')
  assert.equal(result.reason, 'offline')
})

test('evaluate: first observation bootstraps without notify', () => {
  const result = evaluateKickLiveNotifyTransition({
    bootstrapped: false,
    previousIsLive: false,
    nextIsLive: true,
    streamKey: 's1',
    alreadyNotified: false,
  })
  assert.equal(result.action, 'bootstrap')
})

test('evaluate: already notified skips', () => {
  const result = evaluateKickLiveNotifyTransition({
    bootstrapped: true,
    previousIsLive: false,
    nextIsLive: true,
    streamKey: 's1',
    alreadyNotified: true,
  })
  assert.equal(result.action, 'none')
  assert.equal(result.reason, 'already_notified')
})

test('message HTML has bold title and Kick link', () => {
  const html = buildKickLiveStartedMessageHtml('https://kick.com/azarov7777')
  assert.match(html, /<b>Стрим начался!<\/b>/)
  assert.match(html, /<a href="https:\/\/kick\.com\/azarov7777">Смотреть на Kick<\/a>/)
  assert.doesNotMatch(html, /https:\/\/kick\.com\/azarov7777<\/a>https/)
})

test('stream key prefers livestream id', () => {
  assert.equal(
    resolveKickLiveStreamKey({
      livestreamId: 42,
      startedAt: '2026-01-01T00:00:00.000Z',
    }),
    '42',
  )
  assert.equal(
    resolveKickLiveStreamKey({ startedAt: '2026-01-01T00:00:00.000Z' }),
    'started:2026-01-01T00:00:00.000Z',
  )
})

test('webhook: bootstrap live then still live → 0 sends', async () => {
  await withTempStore(async () => {
    let telegramCalls = 0
    const fetchImpl = async (url) => {
      const href = String(url)
      if (href.includes('api.telegram.org')) {
        telegramCalls += 1
        return { ok: true, json: async () => ({ ok: true, result: {} }) }
      }
      return liveFetchImpl()(url)
    }

    const first = await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: true,
        livestream: { id: 'stream-a' },
        started_at: '2026-09-01T11:00:00.000Z',
      },
      { fetchImpl },
    )
    assert.equal(first.notify?.sent, false)
    assert.equal(first.notify?.reason, 'first_observation')

    const second = await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: true,
        livestream: { id: 'stream-a' },
        started_at: '2026-09-01T11:00:00.000Z',
      },
      { fetchImpl },
    )
    assert.equal(second.notify?.sent, false)
    assert.equal(second.notify?.reason, 'still_live')
    assert.equal(telegramCalls, 0)
  })
})

test('webhook: offline → live sends once; live → live no second', async () => {
  await withTempStore(async () => {
    let telegramCalls = 0
    const fetchImpl = async (url) => {
      const href = String(url)
      if (href.includes('api.telegram.org')) {
        telegramCalls += 1
        return { ok: true, json: async () => ({ ok: true, result: {} }) }
      }
      return liveFetchImpl()(url)
    }

    await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: false,
        started_at: null,
      },
      { fetchImpl },
    )

    const live1 = await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: true,
        livestream: { id: 'stream-b' },
        started_at: '2026-09-01T12:00:00.000Z',
      },
      { fetchImpl },
    )
    assert.equal(live1.notify?.sent, true)
    assert.equal(telegramCalls, 1)

    const live2 = await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: true,
        livestream: { id: 'stream-b' },
        started_at: '2026-09-01T12:00:00.000Z',
      },
      { fetchImpl },
    )
    assert.equal(live2.notify?.sent, false)
    assert.equal(telegramCalls, 1)

    withStore((store) => {
      assert.equal(hasKickWebhookEvent(store, kickLiveNotifyEventKey('stream-b')), true)
      return true
    })
  })
})

test('webhook: offline → live → offline → live sends twice', async () => {
  await withTempStore(async () => {
    let telegramCalls = 0
    const fetchImpl = async (url) => {
      const href = String(url)
      if (href.includes('api.telegram.org')) {
        telegramCalls += 1
        return { ok: true, json: async () => ({ ok: true, result: {} }) }
      }
      return liveFetchImpl()(url)
    }

    await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: false,
      },
      { fetchImpl },
    )
    await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: true,
        livestream: { id: 's1' },
        started_at: '2026-09-01T13:00:00.000Z',
      },
      { fetchImpl },
    )
    await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: false,
        livestream: { id: 's1' },
      },
      { fetchImpl },
    )
    await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: true,
        livestream: { id: 's2' },
        started_at: '2026-09-01T15:00:00.000Z',
      },
      { fetchImpl },
    )
    assert.equal(telegramCalls, 2)
  })
})

test('duplicate claim for same stream → one notify plan', () => {
  withTempStore(() => {
    // Bootstrap first observation.
    withStore((store) => {
      const first = planKickLiveStartedNotifyOnStore(store, {
        previousIsLive: false,
        isLive: false,
        streamKey: 'dup',
      })
      assert.equal(first.shouldSend, false)
      assert.equal(first.reason, 'first_observation')
      return true
    })

    withStore((store) => {
      const a = planKickLiveStartedNotifyOnStore(store, {
        previousIsLive: false,
        isLive: true,
        streamKey: 'dup',
      })
      assert.equal(a.shouldSend, true)
      const b = planKickLiveStartedNotifyOnStore(store, {
        previousIsLive: false,
        isLive: true,
        streamKey: 'dup',
      })
      assert.equal(b.shouldSend, false)
      assert.equal(b.reason, 'already_notified')
      return true
    })
  })
})

test('telegram failure unclaims so retry can send', async () => {
  await withTempStore(async () => {
    await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: false,
      },
      { fetchImpl: failingTelegramFetchImpl() },
    )

    const failed = await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: true,
        livestream: { id: 'fail-stream' },
        started_at: '2026-09-01T16:00:00.000Z',
      },
      { fetchImpl: failingTelegramFetchImpl() },
    )
    assert.equal(failed.notify?.sent, false)
    assert.equal(failed.notify?.attempted, true)

    withStore((store) => {
      assert.equal(hasKickWebhookEvent(store, kickLiveNotifyEventKey('fail-stream')), false)
      return true
    })

    let telegramCalls = 0
    const okFetch = async (url) => {
      const href = String(url)
      if (href.includes('api.telegram.org')) {
        telegramCalls += 1
        return { ok: true, json: async () => ({ ok: true, result: {} }) }
      }
      return liveFetchImpl()(url)
    }

    const retry = await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: true,
        livestream: { id: 'fail-stream' },
        started_at: '2026-09-01T16:00:00.000Z',
      },
      { fetchImpl: okFetch },
    )
    // still_live after failed attempt (state already live) — need offline edge for retry
    // After failed send, state is live; retry same webhook is still_live.
    // Unclaim allows re-notify only on a fresh OFFLINE→LIVE.
    assert.equal(retry.notify?.reason, 'still_live')
    assert.equal(telegramCalls, 0)

    await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: false,
        livestream: { id: 'fail-stream' },
      },
      { fetchImpl: okFetch },
    )
    const afterOffline = await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: true,
        livestream: { id: 'fail-stream' },
        started_at: '2026-09-01T16:00:00.000Z',
      },
      { fetchImpl: okFetch },
    )
    assert.equal(afterOffline.notify?.sent, true)
    assert.equal(telegramCalls, 1)
  })
})

test('wrong channel ignored', async () => {
  await withTempStore(async () => {
    let telegramCalls = 0
    const fetchImpl = async (url) => {
      const href = String(url)
      if (href.includes('api.telegram.org')) {
        telegramCalls += 1
        return { ok: true, json: async () => ({ ok: true, result: {} }) }
      }
      return liveFetchImpl()(url)
    }

    await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: false,
      },
      { fetchImpl },
    )

    const other = await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 999, channel_slug: 'someone-else' },
        is_live: true,
        livestream: { id: 'other' },
      },
      { fetchImpl },
    )
    assert.equal(other.ignored, true)
    assert.equal(other.reason, 'wrong_channel')
    assert.equal(telegramCalls, 0)
  })
})

test('sendKickLiveStartedTelegram reports failure without throwing', async () => {
  const prev = process.env.KICK_NOTIFICATION_CHAT_ID
  const prevToken = process.env.BOT_TOKEN
  process.env.KICK_NOTIFICATION_CHAT_ID = '-1001'
  process.env.BOT_TOKEN = 'x'
  try {
    const result = await sendKickLiveStartedTelegram({
      streamKey: 'x',
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        json: async () => ({ ok: false, description: 'fail' }),
      }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.sent, 0)
  } finally {
    if (prev === undefined) delete process.env.KICK_NOTIFICATION_CHAT_ID
    else process.env.KICK_NOTIFICATION_CHAT_ID = prev
    if (prevToken === undefined) delete process.env.BOT_TOKEN
    else process.env.BOT_TOKEN = prevToken
  }
})

test('unclaim removes dedupe key', () => {
  resetKickLiveNotifyBootstrapForTests()
  const prevChat = process.env.KICK_NOTIFICATION_CHAT_ID
  process.env.KICK_NOTIFICATION_CHAT_ID = '-100111'
  try {
    const store = createEmptyStore()
    planKickLiveStartedNotifyOnStore(store, {
      previousIsLive: false,
      isLive: false,
      streamKey: 'u1',
    })
    const claimed = planKickLiveStartedNotifyOnStore(store, {
      previousIsLive: false,
      isLive: true,
      streamKey: 'u1',
    })
    assert.equal(claimed.claimed, true)
    unclaimKickLiveNotify(store, 'u1')
    assert.equal(hasKickWebhookEvent(store, kickLiveNotifyEventKey('u1')), false)
  } finally {
    if (prevChat === undefined) delete process.env.KICK_NOTIFICATION_CHAT_ID
    else process.env.KICK_NOTIFICATION_CHAT_ID = prevChat
    resetKickLiveNotifyBootstrapForTests()
  }
})
