import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { _resetKickApiCaches } from './kick-api.mjs'
import { linkKickAccountOnStore } from './kick-oauth.mjs'
import {
  applyWatchActivityOnStore,
  closeWatchSessionsOnStore,
  getWatchActivityWindowMs,
  recordChatMessageOnStore,
} from './kick-stats.mjs'
import {
  processChatMessageSent,
  processLivestreamStatusUpdated,
  updateKickLivestreamStateOnStore,
} from './kick-streak.mjs'
import { computeLevelProgress, computeXpFromStats, XP_PER_LEVEL } from './level.mjs'
import { claimAchievementOnStore, readAchievementProgress } from './profile.mjs'
import { withStore } from './store.mjs'
import { createUser, toPublicUser } from './users.mjs'
import { addCoins, TX_TYPE } from './wallet.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-kick-stats-'))
  const previous = process.env.AZAROV_STORE_DIR
  const prevClient = process.env.KICK_CLIENT_ID
  const prevSecret = process.env.KICK_CLIENT_SECRET
  const prevRedirect = process.env.KICK_REDIRECT_URI
  const prevChannel = process.env.KICK_REQUIRED_CHANNEL
  const prevWindow = process.env.KICK_WATCH_ACTIVITY_WINDOW

  process.env.AZAROV_STORE_DIR = dir
  process.env.KICK_CLIENT_ID = 'test-client'
  process.env.KICK_CLIENT_SECRET = 'test-secret'
  process.env.KICK_REDIRECT_URI = 'https://example.com/api/kick/callback'
  process.env.KICK_REQUIRED_CHANNEL = 'azarov7777'
  process.env.KICK_WATCH_ACTIVITY_WINDOW = '10'

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
      if (prevWindow === undefined) delete process.env.KICK_WATCH_ACTIVITY_WINDOW
      else process.env.KICK_WATCH_ACTIVITY_WINDOW = prevWindow
      _resetKickApiCaches()
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

function chatPayload({
  senderId,
  broadcasterId = '37093990',
  slug = 'azarov7777',
  messageId = 'msg-1',
  createdAt,
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

function liveFetchImpl(isLive = true, startedAt = '2026-09-01T10:00:00.000Z') {
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
                  started_at: startedAt,
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

function setFreshLive(store, { isLive = true, startedAt = '2026-09-01T10:00:00.000Z' } = {}) {
  updateKickLivestreamStateOnStore(store, {
    broadcasterUserId: '37093990',
    channelSlug: 'azarov7777',
    isLive,
    startedAt,
    endedAt: isLive ? null : '2026-09-01T12:00:00.000Z',
    source: 'test',
  })
}

test('chat message → +1 message for linked user on required channel', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 501, '9001')
      setFreshLive(store, { isLive: true })
      return true
    })

    const result = await processChatMessageSent(
      chatPayload({
        senderId: '9001',
        messageId: 'm-1',
        createdAt: '2026-09-01T10:05:00.000Z',
      }),
      { messageId: 'evt-m-1', options: { fetchImpl: liveFetchImpl(true) } },
    )

    assert.equal(result.ok, true)
    withStore((store) => {
      assert.equal(store.users['501'].chatMessages, 1)
      return true
    })
  })
})

test('message on other channel → +0', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 502, '9002')
      setFreshLive(store, { isLive: true })
      return true
    })

    await processChatMessageSent(
      chatPayload({
        senderId: '9002',
        broadcasterId: '111',
        slug: 'other',
        messageId: 'm-other',
        createdAt: '2026-09-01T10:05:00.000Z',
      }),
      { messageId: 'evt-other', options: { fetchImpl: liveFetchImpl(true) } },
    )

    withStore((store) => {
      assert.equal(store.users['502'].chatMessages || 0, 0)
      return true
    })
  })
})

test('unlinked Kick user → +0 messages', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      createUser(store, { id: 503, first_name: 'X', username: 'x503' })
      setFreshLive(store, { isLive: true })
      return true
    })

    const result = await processChatMessageSent(
      chatPayload({
        senderId: '9999',
        messageId: 'm-unlinked',
        createdAt: '2026-09-01T10:05:00.000Z',
      }),
      { messageId: 'evt-unlinked', options: { fetchImpl: liveFetchImpl(true) } },
    )

    assert.equal(result.reason, 'unlinked_kick')
    withStore((store) => {
      assert.equal(store.users['503'].chatMessages || 0, 0)
      return true
    })
  })
})

test('duplicate webhook → messages not double-counted', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 504, '9004')
      setFreshLive(store, { isLive: true })
      return true
    })

    const payload = chatPayload({
      senderId: '9004',
      messageId: 'm-dup',
      createdAt: '2026-09-01T10:05:00.000Z',
    })
    const opts = { messageId: 'evt-dup', options: { fetchImpl: liveFetchImpl(true) } }

    await processChatMessageSent(payload, opts)
    await processChatMessageSent(payload, opts)

    withStore((store) => {
      assert.equal(store.users['504'].chatMessages, 1)
      return true
    })
  })
})

test('watch: first activity starts session with 0 credit', () => {
  withTempStore(() => {
    withStore((store) => {
      linkUser(store, 601, '9601')
      const r = applyWatchActivityOnStore(store, 601, {
        atIso: '2026-09-01T10:00:00.000Z',
        streamId: 'stream-a',
        isLiveConfirmed: true,
      })
      assert.equal(r.addedSeconds, 0)
      assert.equal(r.reason, 'session_started')
      assert.equal(store.users['601'].watchSeconds || 0, 0)
      return true
    })
  })
})

test('watch: second activity +5 minutes credits 300s', () => {
  withTempStore(() => {
    withStore((store) => {
      linkUser(store, 602, '9602')
      applyWatchActivityOnStore(store, 602, {
        atIso: '2026-09-01T10:00:00.000Z',
        streamId: 'stream-a',
        isLiveConfirmed: true,
      })
      const r = applyWatchActivityOnStore(store, 602, {
        atIso: '2026-09-01T10:05:00.000Z',
        streamId: 'stream-a',
        isLiveConfirmed: true,
      })
      assert.equal(r.addedSeconds, 300)
      assert.equal(store.users['602'].watchSeconds, 300)
      return true
    })
  })
})

test('watch: gap > activity window does not credit the gap', () => {
  withTempStore(() => {
    assert.equal(getWatchActivityWindowMs(), 10 * 60 * 1000)
    withStore((store) => {
      linkUser(store, 603, '9603')
      applyWatchActivityOnStore(store, 603, {
        atIso: '2026-09-01T10:00:00.000Z',
        streamId: 'stream-a',
        isLiveConfirmed: true,
      })
      applyWatchActivityOnStore(store, 603, {
        atIso: '2026-09-01T10:05:00.000Z',
        streamId: 'stream-a',
        isLiveConfirmed: true,
      })
      const r = applyWatchActivityOnStore(store, 603, {
        atIso: '2026-09-01T10:30:00.000Z',
        streamId: 'stream-a',
        isLiveConfirmed: true,
      })
      assert.equal(r.reason, 'session_restart')
      assert.equal(r.addedSeconds, 0)
      assert.equal(store.users['603'].watchSeconds, 300)
      return true
    })
  })
})

test('watch: offline / not live → no watch credit', () => {
  withTempStore(() => {
    withStore((store) => {
      linkUser(store, 604, '9604')
      const r = applyWatchActivityOnStore(store, 604, {
        atIso: '2026-09-01T10:00:00.000Z',
        isLiveConfirmed: false,
      })
      assert.equal(r.addedSeconds, 0)
      assert.equal(store.users['604'].watchSeconds || 0, 0)
      return true
    })
  })
})

test('watch: stream end closes sessions', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 605, '9605')
      applyWatchActivityOnStore(store, 605, {
        atIso: '2026-09-01T10:00:00.000Z',
        streamId: 'started:2026-09-01T10:00:00.000Z',
        isLiveConfirmed: true,
      })
      applyWatchActivityOnStore(store, 605, {
        atIso: '2026-09-01T10:04:00.000Z',
        streamId: 'started:2026-09-01T10:00:00.000Z',
        isLiveConfirmed: true,
      })
      assert.ok(store.kickWatchStats['605'].currentSessionStartedAt)
      return true
    })

    await processLivestreamStatusUpdated(
      {
        broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
        is_live: false,
        started_at: '2026-09-01T10:00:00.000Z',
        ended_at: '2026-09-01T10:08:00.000Z',
      },
      { fetchImpl: liveFetchImpl(false) },
    )

    withStore((store) => {
      assert.equal(store.kickWatchStats['605'].currentSessionStartedAt, null)
      assert.ok(store.users['605'].watchSeconds >= 240)
      return true
    })
  })
})

test('watch: duplicate chat webhook does not double watch time', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 606, '9606')
      setFreshLive(store, { isLive: true, startedAt: '2026-09-01T10:00:00.000Z' })
      return true
    })

    const t0 = '2026-09-01T10:00:00.000Z'
    const t1 = '2026-09-01T10:05:00.000Z'
    await processChatMessageSent(
      chatPayload({ senderId: '9606', messageId: 'w1', createdAt: t0 }),
      { messageId: 'ew1', options: { fetchImpl: liveFetchImpl(true) } },
    )
    await processChatMessageSent(
      chatPayload({ senderId: '9606', messageId: 'w2', createdAt: t1 }),
      { messageId: 'ew2', options: { fetchImpl: liveFetchImpl(true) } },
    )
    const before = withStore((store) => store.users['606'].watchSeconds)
    await processChatMessageSent(
      chatPayload({ senderId: '9606', messageId: 'w2', createdAt: t1 }),
      { messageId: 'ew2', options: { fetchImpl: liveFetchImpl(true) } },
    )
    withStore((store) => {
      assert.equal(store.users['606'].watchSeconds, before)
      assert.equal(store.users['606'].chatMessages, 2)
      return true
    })
  })
})

test('watch: stream id change restarts session without gap credit', () => {
  withTempStore(() => {
    withStore((store) => {
      linkUser(store, 607, '9607')
      applyWatchActivityOnStore(store, 607, {
        atIso: '2026-09-01T10:00:00.000Z',
        streamId: 'stream-a',
        isLiveConfirmed: true,
      })
      applyWatchActivityOnStore(store, 607, {
        atIso: '2026-09-01T10:05:00.000Z',
        streamId: 'stream-a',
        isLiveConfirmed: true,
      })
      const r = applyWatchActivityOnStore(store, 607, {
        atIso: '2026-09-01T10:08:00.000Z',
        streamId: 'stream-b',
        isLiveConfirmed: true,
      })
      assert.equal(r.reason, 'stream_changed')
      assert.equal(r.addedSeconds, 0)
      assert.equal(store.users['607'].watchSeconds, 300)
      return true
    })
  })
})

test('watch: time never becomes negative', () => {
  withTempStore(() => {
    withStore((store) => {
      linkUser(store, 608, '9608')
      applyWatchActivityOnStore(store, 608, {
        atIso: '2026-09-01T10:10:00.000Z',
        streamId: 's',
        isLiveConfirmed: true,
      })
      const r = applyWatchActivityOnStore(store, 608, {
        atIso: '2026-09-01T10:00:00.000Z',
        streamId: 's',
        isLiveConfirmed: true,
      })
      assert.equal(r.addedSeconds, 0)
      assert.ok((store.users['608'].watchSeconds || 0) >= 0)
      return true
    })
  })
})

test('watch: not live confirmed prevents free watch time', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      linkUser(store, 609, '9609')
      setFreshLive(store, { isLive: false })
      return true
    })

    await processChatMessageSent(
      chatPayload({
        senderId: '9609',
        messageId: 'off1',
        createdAt: '2026-09-01T10:05:00.000Z',
      }),
      { messageId: 'e-off1', options: { fetchImpl: liveFetchImpl(false) } },
    )

    withStore((store) => {
      assert.equal(store.users['609'].chatMessages, 1)
      assert.equal(store.users['609'].watchSeconds || 0, 0)
      return true
    })
  })
})

test('XP and level formulas', () => {
  assert.equal(computeXpFromStats({ chatMessages: 10, watchSeconds: 125 }), 12)
  const mid = computeLevelProgress(1240)
  assert.equal(mid.level, Math.floor(1240 / XP_PER_LEVEL) + 1)
  assert.equal(mid.xpForCurrentLevel, XP_PER_LEVEL * (mid.level - 1))
  assert.equal(mid.xpForNextLevel, XP_PER_LEVEL * mid.level)
  assert.equal(mid.xp, 1240)
  assert.ok(mid.progress >= 0 && mid.progress <= 100)

  const zero = computeLevelProgress(0)
  assert.equal(zero.level, 1)
})

test('level does not decrease when peakLevel is higher', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 701, first_name: 'L', username: 'l701' })
      user.chatMessages = 0
      user.watchSeconds = 0
      user.peakLevel = 9
      const pub = toPublicUser(user, store)
      assert.equal(pub.level, 9)
      return true
    })
  })
})

test('profile public user returns xp/level/stats', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 702, first_name: 'P', username: 'p702' })
      user.chatMessages = 50
      store.kickWatchStats = {
        '702': {
          totalWatchSeconds: 3600,
          currentSessionStartedAt: null,
          lastSeenAt: null,
          lastStreamId: null,
        },
      }
      const pub = toPublicUser(user, store)
      assert.equal(pub.chatMessages, 50)
      assert.equal(pub.watchSeconds, 3600)
      assert.equal(pub.streamHours, 1)
      assert.equal(pub.xp, 50 + 60)
      assert.ok(pub.level >= 1)
      assert.ok(pub.xpForNextLevel > pub.xpForCurrentLevel)
      return true
    })
  })
})

test('1000 messages → chat achievement claimable', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 801, first_name: 'A', username: 'a801' })
      user.chatMessages = 1000
      const progress = readAchievementProgress(store, user)
      const item = progress.find((a) => a.id === 'chat-messages')
      assert.equal(item.status, 'claimable')
      return true
    })
  })
})

test('100 watch hours → stream achievement claimable', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 802, first_name: 'B', username: 'b802' })
      store.kickWatchStats = {
        '802': {
          totalWatchSeconds: 100 * 3600,
          currentSessionStartedAt: null,
          lastSeenAt: null,
          lastStreamId: null,
        },
      }
      const progress = readAchievementProgress(store, user)
      const item = progress.find((a) => a.id === 'stream-hours')
      assert.equal(item.status, 'claimable')
      assert.equal(item.current, 100)
      return true
    })
  })
})

test('claim achievement reward still works with real counters', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 803, first_name: 'C', username: 'c803' })
      user.chatMessages = 1000
      user.balance = 0
      const result = claimAchievementOnStore(store, 803, 'chat-messages')
      assert.equal(result.success, true)
      assert.equal(store.users['803'].balance, 3000)
      return true
    })
  })
})

test('coins-earned uses ledger income, not balance', () => {
  withTempStore(() => {
    withStore((store) => {
      const user = createUser(store, { id: 804, first_name: 'D', username: 'd804' })
      user.balance = 50
      addCoins(store, user, 100_000, TX_TYPE.TASK_REWARD, 'task:x', {
        description: 'task',
      })
      // Spend some so balance != earned
      store.users['804'].balance = 10
      const progress = readAchievementProgress(store, store.users['804'])
      const item = progress.find((a) => a.id === 'coins-earned')
      assert.equal(item.status, 'claimable')
      return true
    })
  })
})

test('recordChatMessageOnStore increments only target user', () => {
  withTempStore(() => {
    withStore((store) => {
      linkUser(store, 901, '9901')
      linkUser(store, 902, '9902')
      recordChatMessageOnStore(store, 901)
      recordChatMessageOnStore(store, 901)
      assert.equal(store.users['901'].chatMessages, 2)
      assert.equal(store.users['902'].chatMessages || 0, 0)
      return true
    })
  })
})

test('closeWatchSessionsOnStore does not invent huge trailing time', () => {
  withTempStore(() => {
    withStore((store) => {
      linkUser(store, 903, '9903')
      applyWatchActivityOnStore(store, 903, {
        atIso: '2026-09-01T10:00:00.000Z',
        streamId: 's1',
        isLiveConfirmed: true,
      })
      closeWatchSessionsOnStore(store, {
        streamId: 's1',
        endedAtIso: '2026-09-01T18:00:00.000Z',
      })
      // 8h gap >> window → no huge credit
      assert.ok((store.users['903'].watchSeconds || 0) <= 10 * 60)
      assert.equal(store.kickWatchStats['903'].currentSessionStartedAt, null)
      return true
    })
  })
})
