import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRollPollScheduler,
  requiresRollRuntimeRecoveryFrom,
  shouldPauseRollPollingWhenHiddenFrom,
} from '../src/lib/roll-runtime-core.ts'

test('Android Telegram requires Roll runtime recovery; desktop does not', () => {
  assert.equal(
    requiresRollRuntimeRecoveryFrom({
      platform: 'android',
      coarsePointer: true,
      telegramWebApp: true,
    }),
    true,
  )
  assert.equal(
    requiresRollRuntimeRecoveryFrom({
      platform: 'ios',
      coarsePointer: true,
      telegramWebApp: true,
    }),
    true,
  )
  assert.equal(
    requiresRollRuntimeRecoveryFrom({
      platform: 'tdesktop',
      coarsePointer: false,
      telegramWebApp: true,
    }),
    false,
  )
  assert.equal(
    requiresRollRuntimeRecoveryFrom({
      platform: 'browser',
      coarsePointer: false,
      telegramWebApp: false,
    }),
    false,
  )
  // Ordinary Android Chrome (not Telegram) — do not force TG recovery.
  assert.equal(
    requiresRollRuntimeRecoveryFrom({
      platform: 'browser',
      coarsePointer: true,
      telegramWebApp: false,
    }),
    false,
  )
  // Phone Telegram WebA/WebK.
  assert.equal(
    requiresRollRuntimeRecoveryFrom({
      platform: 'weba',
      coarsePointer: true,
      telegramWebApp: true,
    }),
    true,
  )
})

test('Android Telegram must not pause Roll polling on document.hidden', () => {
  assert.equal(
    shouldPauseRollPollingWhenHiddenFrom({
      platform: 'android',
      coarsePointer: true,
      telegramWebApp: true,
    }),
    false,
  )
  assert.equal(
    shouldPauseRollPollingWhenHiddenFrom({
      platform: 'tdesktop',
      coarsePointer: false,
      telegramWebApp: true,
    }),
    true,
  )
  assert.equal(
    shouldPauseRollPollingWhenHiddenFrom({
      platform: 'browser',
      coarsePointer: false,
      telegramWebApp: false,
    }),
    true,
  )
})

test('poll scheduler is single-flight across burst recover() calls', async () => {
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
  const flush = async (advanceMs) => {
    now += advanceMs
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
  let pollCalls = 0
  const poll = () => {
    pollCalls += 1
    return new Promise((resolve) => {
      resolvePoll = resolve
    })
  }

  const scheduler = createRollPollScheduler({
    poll,
    setTimeoutFn,
    clearTimeoutFn,
  })
  scheduler.start(() => 1_000)

  // First tick started immediately.
  assert.equal(scheduler.startedCount(), 1)
  assert.equal(scheduler.isInFlight(), true)

  // Burst recover while in-flight → queued, not parallel.
  scheduler.recover('visibility')
  scheduler.recover('focus')
  scheduler.recover('viewport')
  assert.equal(scheduler.startedCount(), 1)

  resolvePoll()
  await Promise.resolve()
  await Promise.resolve()

  // Pending recover runs one more poll (not three).
  assert.equal(scheduler.startedCount(), 2)
  assert.equal(pollCalls, 2)

  resolvePoll()
  await Promise.resolve()
  await Promise.resolve()

  // Next scheduled tick after interval.
  assert.equal(scheduler.startedCount(), 2)
  await flush(1_000)
  assert.equal(scheduler.startedCount(), 3)

  resolvePoll()
  await Promise.resolve()
  scheduler.stop()
  assert.equal(timers.length, 0)
})

test('poll scheduler resumes after skip-when-hidden then recover', async () => {
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
  const flush = async (advanceMs) => {
    now += advanceMs
    const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)
    for (const t of due) {
      const idx = timers.indexOf(t)
      if (idx >= 0) timers.splice(idx, 1)
      t.fn()
    }
    await Promise.resolve()
  }

  let hidden = true
  let polls = 0
  const scheduler = createRollPollScheduler({
    poll: async () => {
      polls += 1
    },
    shouldSkipTick: () => hidden,
    setTimeoutFn,
    clearTimeoutFn,
  })
  scheduler.start(() => 500)
  // First tick skipped because hidden.
  assert.equal(polls, 0)
  await flush(500)
  assert.equal(polls, 0)

  hidden = false
  scheduler.recover('visible')
  await Promise.resolve()
  assert.equal(polls, 1)
  scheduler.stop()
})
