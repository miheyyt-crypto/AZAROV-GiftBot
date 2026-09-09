import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { _resetKickApiCaches } from './kick-api.mjs'
import { linkKickAccountOnStore } from './kick-oauth.mjs'
import {
  applyChatActivityToStreak,
  getKickStreakForUser,
  hasKickWebhookEvent,
  isMessageDuringLive,
  LIVE_STATE_STALE_MS,
  processChatMessageSent,
  processLivestreamStatusUpdated,
  reconcileStreakForToday,
  streakDayDiff,
  toStreakCalendarDate,
  updateKickLivestreamStateOnStore,
} from './kick-streak.mjs'
import { STREAK_FREEZE_PRODUCT_ID } from './constants.mjs'
import { resetKickLiveNotifyBootstrapForTests } from './kick-live-notify.mjs'
import { getCoinHistory } from './profile.mjs'
import { withStore } from './store.mjs'
import { createUser } from './users.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-kick-streak-'))
  const previous = process.env.AZAROV_STORE_DIR
  const prevClient = process.env.KICK_CLIENT_ID
  resetKickLiveNotifyBootstrapForTests()
  const prevSecret = process.env.KICK_CLIENT_SECRET
  const prevRedirect = process.env.KICK_REDIRECT_URI
  const prevChannel = process.env.KICK_REQUIRED_CHANNEL

  process.env.AZAROV_STORE_DIR = dir
  process.env.KICK_CLIENT_ID = 'test-client'
  process.env.KICK_CLIENT_SECRET = 'test-secret'
  process.env.KICK_REDIRECT_URI = 'https://example.com/api/kick/callback'
  process.env.KICK_REQUIRED_CHANNEL = 'azarov7777'
  delete process.env.KICK_NOTIFICATION_CHAT_ID

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
      resetKickLiveNotifyBootstrapForTests()
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

function utcDateOffset(daysFromToday) {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + daysFromToday)
  return d.toISOString()
}

function chatPayload({
  senderId,
  broadcasterId = '37093990',
  slug = 'azarov7777',
  messageId = 'msg-1',
  createdAt = utcDateOffset(0),
}) {
  return {
    message_id: messageId,
    created_at: createdAt,
    broadcaster: {
      user_id: Number(broadcasterId),
      channel_slug: slug,
      username: slug,
    },
    sender: {
      user_id: Number(senderId),
      username: 'viewer',
      channel_slug: 'viewer',
    },
    content: 'hi',
  }
}

function liveFetchImpl(isLive = true) {
  return async (url) => {
    const target = String(url)
    if (target.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'app-token', expires_in: 3600 }),
      }
    }
    if (target.includes('/public/v1/channels')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ broadcaster_user_id: 37093990, slug: 'azarov7777' }],
        }),
      }
    }
    if (target.includes('/public/v1/livestreams')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: isLive
            ? [
                {
                  broadcaster_user_id: 37093990,
                  started_at: '2026-09-01T10:00:00.000Z',
                  stream_title: 'live',
                },
              ]
            : [],
        }),
      }
    }
    throw new Error(`unexpected url ${target}`)
  }
}

function channelResolveFailFetchImpl() {
  return async (url) => {
    const target = String(url)
    if (target.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'app-token', expires_in: 3600 }),
      }
    }
    if (target.includes('/public/v1/channels') || target.includes('kick.com/api/v2/channels')) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ message: 'unavailable' }),
      }
    }
    throw new Error(`unexpected url ${target}`)
  }
}

function livestreamErrorFetchImpl() {
  return async (url) => {
    const target = String(url)
    if (target.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'app-token', expires_in: 3600 }),
      }
    }
    if (target.includes('/public/v1/channels')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ broadcaster_user_id: 37093990, slug: 'azarov7777' }],
        }),
      }
    }
    if (target.includes('/public/v1/livestreams')) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ message: 'down' }),
      }
    }
    throw new Error(`unexpected url ${target}`)
  }
}

function makeStaleLiveStoreState(store, { isLive = true } = {}) {
  updateKickLivestreamStateOnStore(store, {
    broadcasterUserId: '37093990',
    channelSlug: 'azarov7777',
    isLive,
    startedAt: utcDateOffset(-1),
    endedAt: isLive ? null : utcDateOffset(-1),
    source: 'test',
  })
  store.kickLivestreamState.updatedAt = new Date(
    Date.now() - LIVE_STATE_STALE_MS - 60_000,
  ).toISOString()
}

test('isMessageDuringLive: fresh and stale fail-closed cases', () => {
  const messageAt = utcDateOffset(0)
  const freshLive = {
    kickLivestreamState: {
      broadcasterUserId: '37093990',
      isLive: true,
      startedAt: utcDateOffset(-1),
      endedAt: null,
      updatedAt: new Date().toISOString(),
    },
  }
  assert.deepEqual(isMessageDuringLive(freshLive, messageAt, null), {
    duringLive: true,
    reason: 'live',
  })

  const freshOffline = {
    kickLivestreamState: {
      broadcasterUserId: '37093990',
      isLive: false,
      startedAt: utcDateOffset(-1),
      endedAt: utcDateOffset(-1),
      updatedAt: new Date().toISOString(),
    },
  }
  assert.deepEqual(isMessageDuringLive(freshOffline, messageAt, null), {
    duringLive: false,
    reason: 'not_live',
  })

  const staleLive = {
    kickLivestreamState: {
      broadcasterUserId: '37093990',
      isLive: true,
      startedAt: utcDateOffset(-1),
      endedAt: null,
      updatedAt: new Date(Date.now() - LIVE_STATE_STALE_MS - 1).toISOString(),
    },
  }
  assert.deepEqual(isMessageDuringLive(staleLive, messageAt, null), {
    duringLive: false,
    reason: 'unconfirmed',
  })
  assert.deepEqual(isMessageDuringLive(staleLive, messageAt, { isLive: false }), {
    duringLive: false,
    reason: 'not_live',
  })
  assert.deepEqual(
    isMessageDuringLive(staleLive, messageAt, {
      isLive: true,
      startedAt: utcDateOffset(-1),
    }),
    { duringLive: true, reason: 'live' },
  )
})

test('stale isLive=true + live API error → no credit, event not marked', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 50, '5001')
      makeStaleLiveStoreState(store, { isLive: true })
      return true
    })

    const result = await processChatMessageSent(
      chatPayload({ senderId: '5001', messageId: 'stale-err', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-stale-err', options: { fetchImpl: livestreamErrorFetchImpl() } },
    )
    assert.equal(result.ignored, true)
    assert.equal(result.reason, 'live_api_unavailable')

    withStore((store) => {
      assert.equal(hasKickWebhookEvent(store, 'evt-stale-err'), false)
      return true
    })
    assert.equal(getKickStreakForUser(50).currentStreak, 0)
  })
})

test('stale isLive=true + live API false → not_live', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 51, '5002')
      makeStaleLiveStoreState(store, { isLive: true })
      return true
    })

    const result = await processChatMessageSent(
      chatPayload({ senderId: '5002', messageId: 'stale-off', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-stale-off', options: { fetchImpl: liveFetchImpl(false) } },
    )
    assert.equal(result.ignored, true)
    assert.equal(result.reason, 'not_live')
  })
})

test('stale isLive=true + live API true → credit', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 52, '5003')
      makeStaleLiveStoreState(store, { isLive: true })
      return true
    })

    const result = await processChatMessageSent(
      chatPayload({ senderId: '5003', messageId: 'stale-on', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-stale-on', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(result.credited, true)
    assert.equal(result.currentStreak, 1)
  })
})

test('live API error then retry succeeds without eating event', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 53, '5004')
      makeStaleLiveStoreState(store, { isLive: true })
      return true
    })

    const payload = chatPayload({
      senderId: '5004',
      messageId: 'retry-msg',
      createdAt: utcDateOffset(0),
    })
    const first = await processChatMessageSent(payload, {
      messageId: 'evt-retry',
      options: { fetchImpl: livestreamErrorFetchImpl() },
    })
    assert.equal(first.reason, 'live_api_unavailable')

    const second = await processChatMessageSent(payload, {
      messageId: 'evt-retry',
      options: { fetchImpl: liveFetchImpl(true) },
    })
    assert.equal(second.credited, true)
    assert.equal(second.currentStreak, 1)
  })
})

test('channel match uses broadcaster ID only', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 60, '6001')
      updateKickLivestreamStateOnStore(store, {
        broadcasterUserId: '37093990',
        channelSlug: 'azarov7777',
        isLive: true,
        startedAt: utcDateOffset(-1),
        source: 'test',
      })
      store.kickLivestreamState.updatedAt = new Date().toISOString()
      return true
    })

    const okBoth = await processChatMessageSent(
      chatPayload({
        senderId: '6001',
        broadcasterId: '37093990',
        slug: 'azarov7777',
        messageId: 'ch-ok',
      }),
      { messageId: 'evt-ch-ok', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(okBoth.credited, true)

    const wrongIdGoodSlug = await processChatMessageSent(
      chatPayload({
        senderId: '6001',
        broadcasterId: '999',
        slug: 'azarov7777',
        messageId: 'ch-bad-id',
      }),
      { messageId: 'evt-ch-bad-id', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(wrongIdGoodSlug.ignored, true)
    assert.equal(wrongIdGoodSlug.reason, 'wrong_channel')

    const goodIdWrongSlug = await processChatMessageSent(
      chatPayload({
        senderId: '6001',
        broadcasterId: '37093990',
        slug: 'totally-different',
        messageId: 'ch-id-only',
        createdAt: utcDateOffset(0),
      }),
      { messageId: 'evt-ch-id-only', options: { fetchImpl: liveFetchImpl(true) } },
    )
    // Same day already credited — channel gate must still accept by ID.
    assert.equal(goodIdWrongSlug.reason, 'same_day')
    assert.equal(goodIdWrongSlug.credited, false)
    assert.equal(goodIdWrongSlug.currentStreak, 1)
  })
})

test('unresolved required channel does not credit', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 61, '6002')
      return true
    })

    const result = await processChatMessageSent(
      chatPayload({ senderId: '6002', messageId: 'no-resolve' }),
      { messageId: 'evt-no-resolve', options: { fetchImpl: channelResolveFailFetchImpl() } },
    )
    assert.equal(result.ignored, true)
    assert.equal(result.reason, 'channel_unresolved')
    assert.equal(getKickStreakForUser(61).currentStreak, 0)
  })
})

test('calendar day helpers use UTC dates', () => {
  assert.equal(toStreakCalendarDate('2026-09-01T23:30:00.000Z'), '2026-09-01')
  assert.equal(toStreakCalendarDate('2026-09-02T00:30:00.000Z'), '2026-09-02')
  assert.equal(streakDayDiff('2026-09-01', '2026-09-02'), 1)
  assert.equal(streakDayDiff('2026-09-01', '2026-09-03'), 2)
})

test('applyChatActivityToStreak: first day, same day, continue, gap reset', () => {
  let record = {
    telegramId: 1,
    kickUserId: '9',
    currentStreak: 0,
    lastActiveDate: null,
    longestStreak: 0,
    activeDays: [],
  }

  let r = applyChatActivityToStreak(record, '2026-09-01')
  assert.equal(r.changed, true)
  assert.equal(r.record.currentStreak, 1)
  record = r.record

  r = applyChatActivityToStreak(record, '2026-09-01')
  assert.equal(r.changed, false)
  assert.equal(r.record.currentStreak, 1)

  r = applyChatActivityToStreak(record, '2026-09-02')
  assert.equal(r.changed, true)
  assert.equal(r.record.currentStreak, 2)
  record = r.record

  r = applyChatActivityToStreak(record, '2026-09-03')
  assert.equal(r.record.currentStreak, 3)
  record = r.record

  // Skip Sep 4 → activity on Sep 5 resets to 1
  r = applyChatActivityToStreak(record, '2026-09-05')
  assert.equal(r.changed, true)
  assert.equal(r.reason, 'reset')
  assert.equal(r.record.currentStreak, 1)
})

test('reconcile breaks streak after a full missed calendar day', () => {
  const broken = reconcileStreakForToday(
    {
      currentStreak: 5,
      lastActiveDate: '2026-09-01',
    },
    '2026-09-03',
  )
  assert.equal(broken.currentStreak, 0)

  const ok = reconcileStreakForToday(
    {
      currentStreak: 5,
      lastActiveDate: '2026-09-02',
    },
    '2026-09-03',
  )
  assert.equal(ok.currentStreak, 5)
})

test('first live chat message credits streak = 1; second same day does not', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 10, '1001')
      updateKickLivestreamStateOnStore(store, {
        broadcasterUserId: '37093990',
        channelSlug: 'azarov7777',
        isLive: true,
        startedAt: utcDateOffset(-1),
        endedAt: null,
        source: 'test',
      })
      store.kickLivestreamState.updatedAt = new Date().toISOString()
      return true
    })

    const first = await processChatMessageSent(
      chatPayload({ senderId: '1001', messageId: 'm1', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(first.credited, true)
    assert.equal(first.currentStreak, 1)

    const second = await processChatMessageSent(
      chatPayload({ senderId: '1001', messageId: 'm2', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-2', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(second.credited, false)
    assert.equal(second.reason, 'same_day')
    assert.equal(second.currentStreak, 1)
  })
})

test('next calendar day continues streak', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 11, '1002')
      updateKickLivestreamStateOnStore(store, {
        broadcasterUserId: '37093990',
        channelSlug: 'azarov7777',
        isLive: true,
        startedAt: utcDateOffset(-2),
        source: 'test',
      })
      store.kickLivestreamState.updatedAt = new Date().toISOString()
      return true
    })

    await processChatMessageSent(
      chatPayload({ senderId: '1002', messageId: 'a', createdAt: utcDateOffset(-1) }),
      { messageId: 'e1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    const next = await processChatMessageSent(
      chatPayload({ senderId: '1002', messageId: 'b', createdAt: utcDateOffset(0) }),
      { messageId: 'e2', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(next.credited, true)
    assert.equal(next.currentStreak, 2)
  })
})

test('missed day resets streak to 1', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 12, '1003')
      updateKickLivestreamStateOnStore(store, {
        broadcasterUserId: '37093990',
        channelSlug: 'azarov7777',
        isLive: true,
        startedAt: utcDateOffset(-5),
        source: 'test',
      })
      store.kickLivestreamState.updatedAt = new Date().toISOString()
      return true
    })

    await processChatMessageSent(
      chatPayload({ senderId: '1003', messageId: 'a', createdAt: utcDateOffset(-3) }),
      { messageId: 'e1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    await processChatMessageSent(
      chatPayload({ senderId: '1003', messageId: 'b', createdAt: utcDateOffset(-2) }),
      { messageId: 'e2', options: { fetchImpl: liveFetchImpl(true) } },
    )
    const afterGap = await processChatMessageSent(
      chatPayload({ senderId: '1003', messageId: 'c', createdAt: utcDateOffset(0) }),
      { messageId: 'e3', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(afterGap.credited, true)
    assert.equal(afterGap.currentStreak, 1)
  })
})

test('wrong channel does not change streak', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 13, '1004')
      return true
    })

    const result = await processChatMessageSent(
      chatPayload({
        senderId: '1004',
        broadcasterId: '999',
        slug: 'someone-else',
        messageId: 'x',
      }),
      { messageId: 'evt-x', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(result.ignored, true)
    assert.equal(result.reason, 'wrong_channel')

    const streak = getKickStreakForUser(13)
    assert.equal(streak.currentStreak, 0)
  })
})

test('unlinked Kick user does not create streak', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      updateKickLivestreamStateOnStore(store, {
        broadcasterUserId: '37093990',
        channelSlug: 'azarov7777',
        isLive: true,
        startedAt: utcDateOffset(-1),
        source: 'test',
      })
      store.kickLivestreamState.updatedAt = new Date().toISOString()
      return true
    })

    const result = await processChatMessageSent(
      chatPayload({ senderId: '9999', messageId: 'u1' }),
      { messageId: 'evt-u', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(result.ignored, true)
    assert.equal(result.reason, 'unlinked_kick')
  })
})

test('offline chat does not credit streak', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 14, '1005')
      updateKickLivestreamStateOnStore(store, {
        broadcasterUserId: '37093990',
        channelSlug: 'azarov7777',
        isLive: false,
        startedAt: utcDateOffset(-1),
        endedAt: utcDateOffset(-1),
        source: 'test',
      })
      store.kickLivestreamState.updatedAt = new Date().toISOString()
      return true
    })

    const result = await processChatMessageSent(
      chatPayload({ senderId: '1005', messageId: 'off', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-off', options: { fetchImpl: liveFetchImpl(false) } },
    )
    assert.equal(result.ignored, true)
    assert.equal(result.reason, 'not_live')
  })
})

test('duplicate event id is idempotent', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 15, '1006')
      updateKickLivestreamStateOnStore(store, {
        broadcasterUserId: '37093990',
        channelSlug: 'azarov7777',
        isLive: true,
        startedAt: utcDateOffset(-1),
        source: 'test',
      })
      store.kickLivestreamState.updatedAt = new Date().toISOString()
      return true
    })

    const payload = chatPayload({
      senderId: '1006',
      messageId: 'same-msg',
      createdAt: utcDateOffset(0),
    })
    const first = await processChatMessageSent(payload, {
      messageId: 'dup-evt',
      options: { fetchImpl: liveFetchImpl(true) },
    })
    assert.equal(first.credited, true)

    const again = await processChatMessageSent(payload, {
      messageId: 'dup-evt',
      options: { fetchImpl: liveFetchImpl(true) },
    })
    assert.equal(again.ignored, true)
    assert.equal(again.reason, 'duplicate_event')

    const streak = getKickStreakForUser(15)
    assert.equal(streak.currentStreak, 1)
  })
})

test('independent streaks for different users', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 21, '2001')
      linkUser(store, 22, '2002')
      updateKickLivestreamStateOnStore(store, {
        broadcasterUserId: '37093990',
        channelSlug: 'azarov7777',
        isLive: true,
        startedAt: utcDateOffset(-2),
        source: 'test',
      })
      store.kickLivestreamState.updatedAt = new Date().toISOString()
      return true
    })

    await processChatMessageSent(
      chatPayload({ senderId: '2001', messageId: 'u1', createdAt: utcDateOffset(-1) }),
      { messageId: 'e-a', options: { fetchImpl: liveFetchImpl(true) } },
    )
    await processChatMessageSent(
      chatPayload({ senderId: '2001', messageId: 'u2', createdAt: utcDateOffset(0) }),
      { messageId: 'e-b', options: { fetchImpl: liveFetchImpl(true) } },
    )
    await processChatMessageSent(
      chatPayload({ senderId: '2002', messageId: 'v1', createdAt: utcDateOffset(0) }),
      { messageId: 'e-c', options: { fetchImpl: liveFetchImpl(true) } },
    )

    assert.equal(getKickStreakForUser(21).currentStreak, 2)
    assert.equal(getKickStreakForUser(22).currentStreak, 1)
  })
})

test('GET streak API shape is scoped to current Telegram user', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 31, '3001')
      linkUser(store, 32, '3002')
      store.kickStreamStreaks = {
        '31': {
          telegramId: 31,
          kickUserId: '3001',
          currentStreak: 7,
          lastActiveDate: toStreakCalendarDate(new Date()),
          longestStreak: 7,
          activeDays: [toStreakCalendarDate(new Date())],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        '32': {
          telegramId: 32,
          kickUserId: '3002',
          currentStreak: 2,
          lastActiveDate: toStreakCalendarDate(new Date()),
          longestStreak: 2,
          activeDays: [toStreakCalendarDate(new Date())],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
      return true
    })

    const mine = getKickStreakForUser(31)
    assert.equal(mine.success, true)
    assert.equal(mine.kickConnected, true)
    assert.equal(mine.currentStreak, 7)
    assert.equal(mine.kickUserId, '3001')
    assert.notEqual(mine.currentStreak, 2)

    const other = getKickStreakForUser(32)
    assert.equal(other.currentStreak, 2)
  })
})

test('livestream status webhook updates live store', async () => {
  await withTempStore(async () => {
    await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: true,
        started_at: '2026-09-01T11:00:00.000Z',
        ended_at: null,
      },
      { fetchImpl: liveFetchImpl(true) },
    )

    withStore((store) => {
      assert.equal(store.kickLivestreamState?.isLive, true)
      assert.equal(store.kickLivestreamState?.broadcasterUserId, '37093990')
      return true
    })
  })
})

test('disconnected user sees connect message and zero streak', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      createUser(store, { id: 40, first_name: 'N', username: 'n40' })
      return true
    })
    const streak = getKickStreakForUser(40)
    assert.equal(streak.kickConnected, false)
    assert.equal(streak.currentStreak, 0)
    assert.match(streak.message || '', /Привяжи Kick/)
  })
})

function seedFreezeOrder(store, telegramId, orderId = 'FRZ001') {
  store.orders = store.orders || {}
  store.inventory = store.inventory || {}
  const user = store.users[String(telegramId)]
  user.orderIds = user.orderIds || []
  user.inventoryIds = user.inventoryIds || []
  const createdAt = new Date().toISOString()
  store.orders[orderId] = {
    orderId,
    userId: Number(telegramId),
    productId: STREAK_FREEZE_PRODUCT_ID,
    productName: 'Заморозка стрика',
    price: 1000,
    status: 'completed',
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    reviewedBy: 'test',
    reviewedAt: createdAt,
    metadata: {},
  }
  user.orderIds = [...user.orderIds, orderId]
  const itemId = `sf:${orderId}`
  store.inventory[itemId] = {
    itemId,
    userId: Number(telegramId),
    type: STREAK_FREEZE_PRODUCT_ID,
    status: 'available',
    sourceOrderId: orderId,
    createdAt,
    consumedAt: null,
    metadata: {},
  }
  user.inventoryIds = [...user.inventoryIds, itemId]
  store.events = store.events || {}
  store.events[`shop:inventory:${orderId}`] = {
    eventId: `shop:inventory:${orderId}`,
    done: true,
    itemId,
    orderId,
    userId: Number(telegramId),
    createdAt,
  }
  store.events[`shop:approve:${orderId}`] = {
    eventId: `shop:approve:${orderId}`,
    done: true,
    orderId,
    createdAt,
  }
  return orderId
}

function setFreshLive(store) {
  updateKickLivestreamStateOnStore(store, {
    broadcasterUserId: '37093990',
    channelSlug: 'azarov7777',
    isLive: true,
    startedAt: utcDateOffset(-5),
    source: 'test',
  })
  store.kickLivestreamState.updatedAt = new Date().toISOString()
}

test('applyChatActivityToStreak: next day does not use freeze flag', () => {
  const record = {
    telegramId: 1,
    kickUserId: '9',
    currentStreak: 3,
    lastActiveDate: '2026-09-01',
    longestStreak: 3,
    activeDays: ['2026-09-01'],
  }
  const r = applyChatActivityToStreak(record, '2026-09-02', { useFreeze: true })
  assert.equal(r.reason, 'continued')
  assert.equal(r.record.currentStreak, 4)
  assert.equal(r.freezeUsed, false)
})

test('applyChatActivityToStreak: one-day gap with freeze keeps streak', () => {
  const record = {
    telegramId: 1,
    kickUserId: '9',
    currentStreak: 8,
    lastActiveDate: '2026-09-02',
    longestStreak: 8,
    activeDays: ['2026-09-01', '2026-09-02'],
  }
  const r = applyChatActivityToStreak(record, '2026-09-04', { useFreeze: true })
  assert.equal(r.reason, 'freeze_saved')
  assert.equal(r.freezeUsed, true)
  assert.equal(r.record.currentStreak, 8)
  assert.equal(r.record.lastActiveDate, '2026-09-04')
})

test('one missed day + Freeze → streak kept, freeze -1, ledger note', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 70, '7001')
      seedFreezeOrder(store, 70, 'FRZ70')
      setFreshLive(store)
      return true
    })

    await processChatMessageSent(
      chatPayload({ senderId: '7001', messageId: 'f1', createdAt: utcDateOffset(-3) }),
      { messageId: 'evt-f1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    await processChatMessageSent(
      chatPayload({ senderId: '7001', messageId: 'f2', createdAt: utcDateOffset(-2) }),
      { messageId: 'evt-f2', options: { fetchImpl: liveFetchImpl(true) } },
    )

    const before = getKickStreakForUser(70)
    assert.equal(before.currentStreak, 2)
    assert.equal(before.freezeAvailable, 1)
    assert.equal(before.freezeAutoConsume, true)

    // Skip -1 → gap of one calendar day before today
    const saved = await processChatMessageSent(
      chatPayload({ senderId: '7001', messageId: 'f3', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-f3', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(saved.reason, 'freeze_saved')
    assert.equal(saved.freezeUsed, true)
    assert.equal(saved.currentStreak, 2)
    assert.equal(saved.freezeAvailable, 0)

    const after = getKickStreakForUser(70)
    assert.equal(after.currentStreak, 2)
    assert.equal(after.freezeAvailable, 0)

    withStore((store) => {
      assert.equal(store.orders.FRZ70.status, 'completed')
      const item = store.inventory['sf:FRZ70']
      assert.equal(item.status, 'consumed')
      assert.equal(item.metadata.consumedForDate, toStreakCalendarDate(utcDateOffset(0)))
      assert.ok(store.coinTransactions[`streak:freeze:70:${toStreakCalendarDate(utcDateOffset(0))}`])
      assert.equal(
        store.coinTransactions[`streak:freeze:70:${toStreakCalendarDate(utcDateOffset(0))}`].type,
        'streak_freeze',
      )
      return true
    })

    const history = getCoinHistory(70, 'all')
    assert.ok(history.transactions.some((t) => t.type === 'streak_freeze' && t.amount === 0))
  })
})

test('one missed day without Freeze → reset', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 71, '7002')
      setFreshLive(store)
      return true
    })

    await processChatMessageSent(
      chatPayload({ senderId: '7002', messageId: 'g1', createdAt: utcDateOffset(-2) }),
      { messageId: 'evt-g1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    const reset = await processChatMessageSent(
      chatPayload({ senderId: '7002', messageId: 'g2', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-g2', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(reset.reason, 'reset')
    assert.equal(reset.freezeUsed, false)
    assert.equal(reset.currentStreak, 1)
  })
})

test('two missed days + Freeze → reset, freeze not spent', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 72, '7003')
      seedFreezeOrder(store, 72, 'FRZ72')
      setFreshLive(store)
      return true
    })

    await processChatMessageSent(
      chatPayload({ senderId: '7003', messageId: 'h1', createdAt: utcDateOffset(-3) }),
      { messageId: 'evt-h1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    const reset = await processChatMessageSent(
      chatPayload({ senderId: '7003', messageId: 'h2', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-h2', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(reset.reason, 'reset')
    assert.equal(reset.freezeUsed, false)
    assert.equal(reset.currentStreak, 1)
    assert.equal(getKickStreakForUser(72).freezeAvailable, 1)

    withStore((store) => {
      assert.equal(store.orders.FRZ72.status, 'completed')
      assert.equal(store.inventory['sf:FRZ72'].status, 'available')
      return true
    })
  })
})

test('next day +1 does not spend Freeze; same day no change', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 73, '7004')
      seedFreezeOrder(store, 73, 'FRZ73')
      setFreshLive(store)
      return true
    })

    await processChatMessageSent(
      chatPayload({ senderId: '7004', messageId: 'i1', createdAt: utcDateOffset(-1) }),
      { messageId: 'evt-i1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    const cont = await processChatMessageSent(
      chatPayload({ senderId: '7004', messageId: 'i2', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-i2', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(cont.reason, 'continued')
    assert.equal(cont.freezeUsed, false)
    assert.equal(cont.currentStreak, 2)
    assert.equal(getKickStreakForUser(73).freezeAvailable, 1)

    const same = await processChatMessageSent(
      chatPayload({ senderId: '7004', messageId: 'i3', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-i3', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(same.reason, 'same_day')
    assert.equal(same.freezeUsed, false)
    assert.equal(getKickStreakForUser(73).freezeAvailable, 1)
  })
})

test('duplicate event after freeze does not spend twice', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 74, '7005')
      seedFreezeOrder(store, 74, 'FRZ74A')
      seedFreezeOrder(store, 74, 'FRZ74B')
      setFreshLive(store)
      return true
    })

    await processChatMessageSent(
      chatPayload({ senderId: '7005', messageId: 'j1', createdAt: utcDateOffset(-2) }),
      { messageId: 'evt-j1', options: { fetchImpl: liveFetchImpl(true) } },
    )

    const payload = chatPayload({
      senderId: '7005',
      messageId: 'j2',
      createdAt: utcDateOffset(0),
    })
    const first = await processChatMessageSent(payload, {
      messageId: 'evt-j2',
      options: { fetchImpl: liveFetchImpl(true) },
    })
    assert.equal(first.freezeUsed, true)
    assert.equal(first.currentStreak, 1)
    assert.equal(getKickStreakForUser(74).freezeAvailable, 1)

    const dup = await processChatMessageSent(payload, {
      messageId: 'evt-j2',
      options: { fetchImpl: liveFetchImpl(true) },
    })
    assert.equal(dup.reason, 'duplicate_event')
    assert.equal(getKickStreakForUser(74).freezeAvailable, 1)
  })
})

test('two near-simultaneous events after gap spend at most one freeze', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 75, '7006')
      seedFreezeOrder(store, 75, 'FRZ75')
      setFreshLive(store)
      return true
    })

    await processChatMessageSent(
      chatPayload({ senderId: '7006', messageId: 'k0', createdAt: utcDateOffset(-2) }),
      { messageId: 'evt-k0', options: { fetchImpl: liveFetchImpl(true) } },
    )

    const a = await processChatMessageSent(
      chatPayload({ senderId: '7006', messageId: 'k1', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-k1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    const b = await processChatMessageSent(
      chatPayload({ senderId: '7006', messageId: 'k2', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-k2', options: { fetchImpl: liveFetchImpl(true) } },
    )

    assert.equal(a.freezeUsed, true)
    assert.equal(b.reason, 'same_day')
    assert.equal(b.freezeUsed, false)
    assert.equal(getKickStreakForUser(75).freezeAvailable, 0)
    assert.equal(getKickStreakForUser(75).currentStreak, 1)
  })
})

test('wrong channel / offline / unlinked do not spend freeze', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 76, '7007')
      seedFreezeOrder(store, 76, 'FRZ76')
      setFreshLive(store)
      store.kickStreamStreaks['76'] = {
        telegramId: 76,
        kickUserId: '7007',
        currentStreak: 5,
        lastActiveDate: toStreakCalendarDate(utcDateOffset(-2)),
        longestStreak: 5,
        activeDays: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      return true
    })

    const wrong = await processChatMessageSent(
      chatPayload({
        senderId: '7007',
        broadcasterId: '999',
        slug: 'azarov7777',
        messageId: 'w1',
      }),
      { messageId: 'evt-w1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(wrong.reason, 'wrong_channel')
    assert.equal(getKickStreakForUser(76).freezeAvailable, 1)

    withStore((store) => {
      store.kickLivestreamState.isLive = false
      store.kickLivestreamState.updatedAt = new Date().toISOString()
      return true
    })
    const offline = await processChatMessageSent(
      chatPayload({ senderId: '7007', messageId: 'w2' }),
      { messageId: 'evt-w2', options: { fetchImpl: liveFetchImpl(false) } },
    )
    assert.equal(offline.reason, 'not_live')
    assert.equal(getKickStreakForUser(76).freezeAvailable, 1)

    withStore((store) => {
      setFreshLive(store)
      return true
    })
    const unlinked = await processChatMessageSent(
      chatPayload({ senderId: '99999', messageId: 'w3' }),
      { messageId: 'evt-w3', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(unlinked.reason, 'unlinked_kick')
    assert.equal(getKickStreakForUser(76).freezeAvailable, 1)
  })
})

test('multiple freezes spend one per separate single-day gap', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 77, '7008')
      seedFreezeOrder(store, 77, 'FRZ77A')
      seedFreezeOrder(store, 77, 'FRZ77B')
      setFreshLive(store)
      return true
    })

    // Day -4
    await processChatMessageSent(
      chatPayload({ senderId: '7008', messageId: 'm1', createdAt: utcDateOffset(-4) }),
      { messageId: 'evt-m1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    // Skip -3 → activity -2 with freeze
    const s1 = await processChatMessageSent(
      chatPayload({ senderId: '7008', messageId: 'm2', createdAt: utcDateOffset(-2) }),
      { messageId: 'evt-m2', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(s1.reason, 'freeze_saved')
    assert.equal(s1.currentStreak, 1)
    assert.equal(getKickStreakForUser(77).freezeAvailable, 1)

    // Skip -1 → activity 0 with second freeze
    const s2 = await processChatMessageSent(
      chatPayload({ senderId: '7008', messageId: 'm3', createdAt: utcDateOffset(0) }),
      { messageId: 'evt-m3', options: { fetchImpl: liveFetchImpl(true) } },
    )
    assert.equal(s2.reason, 'freeze_saved')
    assert.equal(s2.currentStreak, 1)
    assert.equal(getKickStreakForUser(77).freezeAvailable, 0)
  })
})
