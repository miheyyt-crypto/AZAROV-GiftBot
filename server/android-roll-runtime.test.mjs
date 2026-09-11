import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ANDROID_SYNC_FAIL_LIMIT,
  createAndroidRollPoller,
  isAndroidTelegramFromHints,
  resolveAndroidPhase,
} from '../src/lib/android-roll-runtime-core.ts'

test('isAndroidTelegramFromHints: Android TG yes; iOS/desktop/Chrome no', () => {
  assert.equal(
    isAndroidTelegramFromHints({
      platform: 'android',
      telegramWebApp: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    }),
    true,
  )
  assert.equal(
    isAndroidTelegramFromHints({
      platform: 'android_x',
      telegramWebApp: true,
      userAgent: 'Android',
    }),
    true,
  )
  assert.equal(
    isAndroidTelegramFromHints({
      platform: 'weba',
      telegramWebApp: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 13)',
    }),
    true,
  )
  assert.equal(
    isAndroidTelegramFromHints({
      platform: 'ios',
      telegramWebApp: true,
      userAgent: 'iPhone',
    }),
    false,
  )
  assert.equal(
    isAndroidTelegramFromHints({
      platform: 'tdesktop',
      telegramWebApp: true,
      userAgent: 'Desktop',
    }),
    false,
  )
  // Android Chrome outside Telegram
  assert.equal(
    isAndroidTelegramFromHints({
      platform: 'browser',
      telegramWebApp: false,
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120',
    }),
    false,
  )
})

test('resolveAndroidPhase: idle → placing → waiting → result; waiting not terminal', () => {
  assert.equal(
    resolveAndroidPhase({
      placing: true,
      syncError: false,
      viewerInRound: false,
      activeRoundId: null,
      round: null,
      nowMs: 1_000,
      skewMs: 0,
      revealAfterMs: 7_000,
    }),
    'placing',
  )

  assert.equal(
    resolveAndroidPhase({
      placing: false,
      syncError: false,
      viewerInRound: true,
      activeRoundId: 'r1',
      round: {
        id: 'r1',
        status: 'waiting',
        players: [{ userId: 1 }],
      },
      nowMs: 1_000,
      skewMs: 0,
      revealAfterMs: 7_000,
    }),
    'waiting',
  )

  // Backend completed while UI was waiting → result
  assert.equal(
    resolveAndroidPhase({
      placing: false,
      syncError: false,
      viewerInRound: true,
      activeRoundId: 'r1',
      round: {
        id: 'r1',
        status: 'completed',
        winnerUserId: 1,
        winner: { userId: 1 },
        players: [{ userId: 1 }, { userId: 2 }],
      },
      nowMs: 1_000,
      skewMs: 0,
      revealAfterMs: 7_000,
    }),
    'result',
  )

  // Spinning with winner past reveal window → result (animation irrelevant)
  assert.equal(
    resolveAndroidPhase({
      placing: false,
      syncError: false,
      viewerInRound: true,
      activeRoundId: 'r1',
      round: {
        id: 'r1',
        status: 'spinning',
        winnerUserId: 2,
        winner: { userId: 2 },
        spinStartedAt: new Date(0).toISOString(),
        players: [{ userId: 1 }, { userId: 2 }],
      },
      nowMs: 20_000,
      skewMs: 0,
      revealAfterMs: 7_000,
    }),
    'result',
  )

  // Spinning before reveal → still waiting (phase), not stuck forever
  assert.equal(
    resolveAndroidPhase({
      placing: false,
      syncError: false,
      viewerInRound: true,
      activeRoundId: 'r1',
      round: {
        id: 'r1',
        status: 'spinning',
        winnerUserId: 2,
        winner: { userId: 2 },
        spinStartedAt: new Date(10_000).toISOString(),
        players: [{ userId: 1 }, { userId: 2 }],
      },
      nowMs: 12_000,
      skewMs: 0,
      revealAfterMs: 7_000,
    }),
    'waiting',
  )

  assert.equal(
    resolveAndroidPhase({
      placing: false,
      syncError: true,
      viewerInRound: true,
      activeRoundId: 'r1',
      round: { id: 'r1', status: 'waiting', players: [{ userId: 1 }] },
      nowMs: 1,
      skewMs: 0,
      revealAfterMs: 7_000,
    }),
    'error',
  )

  assert.equal(
    resolveAndroidPhase({
      placing: false,
      syncError: false,
      viewerInRound: false,
      activeRoundId: null,
      round: { id: 'r0', status: 'waiting', players: [] },
      nowMs: 1,
      skewMs: 0,
      revealAfterMs: 7_000,
    }),
    'idle',
  )
})

test('Android poller: single-flight under burst kick; remount uses new generation', async () => {
  const timers = []
  let now = 0
  const setTimeoutFn = (fn, ms) => {
    const id = { at: now + ms, fn }
    timers.push(id)
    return id
  }
  const clearTimeoutFn = (id) => {
    const idx = timers.indexOf(id)
    if (idx >= 0) timers.splice(idx, 1)
  }
  const flush = async (ms) => {
    now += ms
    const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)
    for (const t of due) {
      const idx = timers.indexOf(t)
      if (idx >= 0) timers.splice(idx, 1)
      t.fn()
    }
    await Promise.resolve()
    await Promise.resolve()
  }

  let resolvePoll
  const statuses = []
  const poll = async () => {
    statuses.push('pending')
    await new Promise((resolve) => {
      resolvePoll = () => {
        statuses.push('completed')
        resolve()
      }
    })
  }

  const poller = createAndroidRollPoller({ poll, setTimeoutFn, clearTimeoutFn })
  poller.start(() => 1_000)
  assert.equal(poller.startedCount(), 1)
  assert.equal(poller.isInFlight(), true)

  // Multiple visibility recoveries while in-flight
  poller.kick('visibility')
  poller.kick('focus')
  poller.kick('visibility')
  assert.equal(poller.startedCount(), 1)

  resolvePoll()
  await Promise.resolve()
  await Promise.resolve()
  // One pending kick drained
  assert.equal(poller.startedCount(), 2)
  resolvePoll()
  await Promise.resolve()
  await Promise.resolve()

  await flush(1_000)
  assert.equal(poller.startedCount(), 3)
  resolvePoll()
  await Promise.resolve()

  const genBefore = poller.generation()
  poller.stop()
  assert.ok(poller.generation() > genBefore)

  // Fresh start after "remount"
  const poller2 = createAndroidRollPoller({
    poll: async () => {},
    setTimeoutFn,
    clearTimeoutFn,
  })
  poller2.start(() => 500)
  assert.equal(poller2.startedCount(), 1)
  poller2.kick('recovery')
  // in-flight empty poll finishes sync; kick may coalesce
  await Promise.resolve()
  await Promise.resolve()
  poller2.stop()

  assert.ok(statuses.includes('pending'))
  assert.ok(statuses.includes('completed'))
  assert.equal(ANDROID_SYNC_FAIL_LIMIT, 6)
})

test('completed backend round immediately resolves on recovery mapping', () => {
  const phase = resolveAndroidPhase({
    placing: false,
    syncError: false,
    viewerInRound: true,
    activeRoundId: 'alive',
    round: {
      id: 'alive',
      status: 'completed',
      winnerUserId: 42,
      winner: { userId: 42 },
      players: [{ userId: 1 }, { userId: 42 }],
    },
    nowMs: Date.now(),
    skewMs: 0,
    revealAfterMs: 7_000,
  })
  assert.equal(phase, 'result')
})

test('animation failure does not prevent result phase', () => {
  // No spinStartedAt / broken clock — completed still → result
  const phase = resolveAndroidPhase({
    placing: false,
    syncError: false,
    viewerInRound: true,
    activeRoundId: 'x',
    round: {
      id: 'x',
      status: 'completed',
      winnerUserId: 7,
      winner: { userId: 7 },
      spinStartedAt: null,
      targetAngle: null,
      players: [{ userId: 7 }],
    },
    nowMs: Date.now(),
    skewMs: 0,
    revealAfterMs: 7_000,
  })
  assert.equal(phase, 'result')
})
