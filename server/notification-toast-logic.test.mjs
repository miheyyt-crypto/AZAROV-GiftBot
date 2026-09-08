import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  SERVER_TOAST_DURATION_MS,
  SERVER_TOAST_MAX_QUEUE,
  SERVER_TOAST_POLL_MS,
  appendToastQueue,
  buildServerToastCopy,
  createServerToastSession,
  ingestPolledNotifications,
  isToastableNotificationType,
  shiftToastQueue,
} from '../src/lib/notification-toast-logic.ts'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function note(partial) {
  return {
    id: partial.id,
    type: partial.type,
    title: partial.title || 't',
    message: partial.message || 'm',
    read: partial.read ?? false,
    createdAt: partial.createdAt || '2026-09-08T12:00:00.000Z',
    metadata: partial.metadata || {},
  }
}

test('initial poll seeds known ids and does not enqueue old notifications', () => {
  const session = createServerToastSession()
  const existing = [
    note({ id: 'a', type: 'PARTNER_SUBMISSION_APPROVED' }),
    note({ id: 'b', type: 'PARTNER_SUBMISSION_REJECTED' }),
    note({ id: 'c', type: 'ORDER_APPROVED' }),
  ]

  const first = ingestPolledNotifications(session, existing)
  assert.equal(first.seededNow, true)
  assert.deepEqual(first.newlyQueued, [])
  assert.equal(session.knownIds.has('a'), true)
  assert.equal(session.knownIds.has('b'), true)
  assert.equal(session.knownIds.has('c'), true)

  const second = ingestPolledNotifications(session, existing)
  assert.equal(second.seededNow, false)
  assert.deepEqual(second.newlyQueued, [])
})

test('new notification after baseline is queued once (dedupe)', () => {
  const session = createServerToastSession()
  ingestPolledNotifications(session, [note({ id: 'old', type: 'SYSTEM' })])

  const fresh = note({
    id: 'new-1',
    type: 'PARTNER_SUBMISSION_APPROVED',
    metadata: { reward: 500 },
  })

  const first = ingestPolledNotifications(session, [
    fresh,
    note({ id: 'old', type: 'SYSTEM' }),
  ])
  assert.equal(first.newlyQueued.length, 1)
  assert.equal(first.newlyQueued[0].id, 'new-1')

  const again = ingestPolledNotifications(session, [
    fresh,
    note({ id: 'old', type: 'SYSTEM' }),
  ])
  assert.deepEqual(again.newlyQueued, [])
})

test('approved / rejected toast copy tones and short reject hint', () => {
  const approved = buildServerToastCopy(
    note({
      id: '1',
      type: 'PARTNER_SUBMISSION_APPROVED',
      metadata: { reward: 500 },
    }),
  )
  assert.equal(approved.tone, 'success')
  assert.equal(approved.title, 'Задание одобрено')
  assert.match(approved.message, /500/)

  const rejected = buildServerToastCopy(
    note({
      id: '2',
      type: 'PARTNER_SUBMISSION_REJECTED',
      metadata: { rejectionReason: 'Очень длинная причина отклонения задания пользователя' },
    }),
  )
  assert.equal(rejected.tone, 'error')
  assert.equal(rejected.title, 'Задание отклонено')
  assert.equal(rejected.message, 'Нажмите, чтобы узнать причину')
  assert.equal(rejected.message.includes('длинная'), false)

  const orderOk = buildServerToastCopy(note({ id: '3', type: 'ORDER_APPROVED' }))
  assert.equal(orderOk.tone, 'success')
  const orderBad = buildServerToastCopy(note({ id: '4', type: 'ORDER_REJECTED' }))
  assert.equal(orderBad.tone, 'error')
})

test('toast duration and poll interval are within expected bounds', () => {
  assert.equal(SERVER_TOAST_DURATION_MS, 5_000)
  assert.ok(SERVER_TOAST_POLL_MS >= 10_000 && SERVER_TOAST_POLL_MS <= 15_000)
})

test('queue keeps only newest entries when flooded', () => {
  const items = Array.from({ length: 8 }, (_, i) =>
    note({ id: `n${i}`, type: 'SYSTEM' }),
  )
  const queued = appendToastQueue([], items, SERVER_TOAST_MAX_QUEUE)
  assert.equal(queued.length, SERVER_TOAST_MAX_QUEUE)
  assert.equal(queued[0].id, 'n3')
  assert.equal(queued[queued.length - 1].id, 'n7')

  const { next, remaining } = shiftToastQueue(queued)
  assert.equal(next.id, 'n3')
  assert.equal(remaining.length, SERVER_TOAST_MAX_QUEUE - 1)
})

test('multiple new notifications enqueue oldest-first', () => {
  const session = createServerToastSession()
  ingestPolledNotifications(session, [])

  // API newest-first: c, b, a
  const result = ingestPolledNotifications(session, [
    note({ id: 'c', type: 'ORDER_APPROVED', createdAt: '2026-09-08T12:03:00.000Z' }),
    note({ id: 'b', type: 'PARTNER_SUBMISSION_APPROVED', createdAt: '2026-09-08T12:02:00.000Z' }),
    note({ id: 'a', type: 'SYSTEM', createdAt: '2026-09-08T12:01:00.000Z' }),
  ])
  assert.deepEqual(
    result.newlyQueued.map((n) => n.id),
    ['a', 'b', 'c'],
  )
})

test('unknown types are not toastable', () => {
  assert.equal(isToastableNotificationType('FAKE_REWARD'), false)
  assert.equal(isToastableNotificationType('PARTNER_SUBMISSION_APPROVED'), true)
})

test('frontend toast layer does not create notifications or auto-mark read', () => {
  const logic = readFileSync(
    path.join(rootDir, 'src/lib/notification-toast-logic.ts'),
    'utf8',
  )
  const poller = readFileSync(
    path.join(rootDir, 'src/components/ServerNotificationToasts.tsx'),
    'utf8',
  )
  const api = readFileSync(path.join(rootDir, 'src/lib/notifications.ts'), 'utf8')

  assert.equal(logic.includes('/api/notifications/create'), false)
  assert.equal(poller.includes('markNotificationAsRead'), false)
  assert.equal(poller.includes('/api/notifications/create'), false)
  assert.match(poller, /fetchNotifications/)
  assert.match(poller, /ingestPolledNotifications/)
  assert.match(poller, /NotificationsSheet/)
  assert.match(api, /\/api\/notifications/)
  assert.equal(api.includes('/api/notifications/create'), false)
})

test('App mounts ServerNotificationToasts only inside AuthGate', () => {
  const app = readFileSync(path.join(rootDir, 'src/App.tsx'), 'utf8')
  assert.match(app, /<AuthGate>/)
  assert.match(app, /<ServerNotificationToasts\s*\/>/)
  const authIdx = app.indexOf('<AuthGate>')
  const toastIdx = app.indexOf('<ServerNotificationToasts')
  assert.ok(toastIdx > authIdx)
})
