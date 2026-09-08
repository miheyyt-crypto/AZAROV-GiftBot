import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createUser } from './users.mjs'
import {
  createNotificationOnStore,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  MAX_NOTIFICATIONS_PER_USER,
  NOTIFICATION_TYPE,
  validateRejectionReason,
} from './notifications.mjs'
import {
  approvePartnerSubmissionOnStore,
  createPartnerSubmissionOnStore,
  rejectPartnerSubmissionOnStore,
} from './partner-submissions.mjs'
import { createEmptyStore, withStore } from './store.mjs'

function pngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
}

function makeStore(...users) {
  const store = createEmptyStore()
  for (const user of users) {
    createUser(store, user)
  }
  return store
}

function signInitData(botToken, fields) {
  const params = new URLSearchParams(fields)
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  params.set('hash', hash)
  return params.toString()
}

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-notif-'))
  const previous = process.env.AZAROV_STORE_DIR
  const prevBot = process.env.BOT_TOKEN
  const prevAdmin = process.env.ADMIN_API_KEY
  process.env.AZAROV_STORE_DIR = dir
  process.env.BOT_TOKEN = '123456:TEST_NOTIF_TOKEN'
  process.env.ADMIN_API_KEY = '0123456789abcdef0123456789abcdef'

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      if (prevBot === undefined) delete process.env.BOT_TOKEN
      else process.env.BOT_TOKEN = prevBot
      if (prevAdmin === undefined) delete process.env.ADMIN_API_KEY
      else process.env.ADMIN_API_KEY = prevAdmin
      rmSync(dir, { recursive: true, force: true })
    })
}

async function listen(app) {
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

test('validateRejectionReason rejects empty / whitespace / short / too long', () => {
  assert.equal(validateRejectionReason('').ok, false)
  assert.equal(validateRejectionReason('   ').ok, false)
  assert.equal(validateRejectionReason('ab').ok, false)
  assert.equal(validateRejectionReason('нет').ok, true)
  assert.equal(validateRejectionReason('x'.repeat(501)).ok, false)
  assert.equal(validateRejectionReason('  Нормальная причина  ').value, 'Нормальная причина')
})

test('approve creates notification with reward metadata; replay is idempotent', () => {
  const store = makeStore({ id: 901, first_name: 'A', username: 'a901' })
  const created = createPartnerSubmissionOnStore(
    store,
    901,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '9001',
      requestId: 'req-notif-approve-aaaaaaaa',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(created.success, true)

  const approved = approvePartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'admin',
    'approve-notif-1',
  )
  assert.equal(approved.success, true)
  assert.equal(store.users['901'].balance, 1000)

  const notes = Object.values(store.notifications).filter((n) => Number(n.userId) === 901)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].type, NOTIFICATION_TYPE.PARTNER_SUBMISSION_APPROVED)
  assert.equal(notes[0].metadata.reward, 1000)
  assert.match(notes[0].message, /1[\u00a0\u202f ]?000|1000/)
  assert.equal(notes[0].read, false)

  const again = approvePartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'admin',
    'approve-notif-2',
  )
  assert.equal(again.success, true)
  assert.equal(store.users['901'].balance, 1000)
  assert.equal(
    Object.values(store.notifications).filter((n) => Number(n.userId) === 901).length,
    1,
  )
})

test('reject requires reason, stores it, and creates rejected notification', () => {
  const store = makeStore({ id: 902, first_name: 'B', username: 'b902' })
  const created = createPartnerSubmissionOnStore(
    store,
    902,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '9002',
      requestId: 'req-notif-reject-bbbbbbbb',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(created.success, true)

  const empty = rejectPartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'admin',
    '  ',
    'reject-empty',
  )
  assert.equal(empty.success, false)
  assert.equal(empty.code, 'MISSING_REJECTION_REASON')
  assert.equal(store.partnerSubmissions[created.submission.submissionId].status, 'pending')
  assert.equal(Object.keys(store.notifications).length, 0)

  const reason = 'Не выполнено условие подписки на Telegram-канал.'
  const rejected = rejectPartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'admin',
    reason,
    'reject-ok',
  )
  assert.equal(rejected.success, true)
  assert.equal(rejected.submission.rejectionReason, reason)
  assert.equal(store.users['902'].balance, 0)

  const notes = Object.values(store.notifications).filter((n) => Number(n.userId) === 902)
  assert.equal(notes.length, 1)
  assert.equal(notes[0].type, NOTIFICATION_TYPE.PARTNER_SUBMISSION_REJECTED)
  assert.equal(notes[0].metadata.rejectionReason, reason)
  assert.match(notes[0].message, /Причина/)
  assert.match(notes[0].message, /Telegram/)

  const again = rejectPartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'admin',
    'другая причина длиннее',
    'reject-again',
  )
  assert.equal(again.success, true)
  assert.equal(again.submission.rejectionReason, reason)
  assert.equal(
    Object.values(store.notifications).filter((n) => Number(n.userId) === 902).length,
    1,
  )
})

test('cannot reject after approve; approve vs reject race keeps one outcome', () => {
  const store = makeStore({ id: 903, first_name: 'C', username: 'c903' })
  const created = createPartnerSubmissionOnStore(
    store,
    903,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '9003',
      requestId: 'req-notif-race-cccccccc',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )

  const approved = approvePartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'admin-a',
    'race-a',
  )
  const rejected = rejectPartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'admin-b',
    'слишком поздно отклонять',
    'race-b',
  )
  assert.equal(approved.success, true)
  assert.equal(rejected.success, false)
  assert.equal(store.partnerSubmissions[created.submission.submissionId].status, 'approved')
  assert.equal(store.users['903'].balance, 1000)

  const types = Object.values(store.notifications)
    .filter((n) => Number(n.userId) === 903)
    .map((n) => n.type)
  assert.deepEqual(types, [NOTIFICATION_TYPE.PARTNER_SUBMISSION_APPROVED])
})

test('createNotificationOnStore is idempotent by eventKey; invalid type blocked', () => {
  const store = makeStore({ id: 904, first_name: 'D', username: 'd904' })
  const first = createNotificationOnStore(store, {
    userId: 904,
    type: NOTIFICATION_TYPE.SYSTEM,
    title: 'Система',
    message: 'Тест',
    eventKey: 'system:test:1',
  })
  const second = createNotificationOnStore(store, {
    userId: 904,
    type: NOTIFICATION_TYPE.SYSTEM,
    title: 'Система 2',
    message: 'Тест 2',
    eventKey: 'system:test:1',
  })
  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(Object.keys(store.notifications).length, 1)

  const bad = createNotificationOnStore(store, {
    userId: 904,
    type: 'FAKE_REWARD',
    title: 'хак',
    message: '+999999',
    eventKey: 'hack:1',
  })
  assert.equal(bad.created, false)
  assert.equal(bad.reason, 'invalid_type')
})

test('mark read is ownership-scoped; list returns only own notifications', async () => {
  await withTempStore(async () => {
    let mineId = ''
    let otherId = ''
    withStore((store) => {
      createUser(store, { id: 910, first_name: 'Me', username: 'me' })
      createUser(store, { id: 911, first_name: 'Other', username: 'other' })
      const mine = createNotificationOnStore(store, {
        userId: 910,
        type: NOTIFICATION_TYPE.SYSTEM,
        title: 'Моё',
        message: 'a',
        eventKey: 'sys:me:1',
      })
      const other = createNotificationOnStore(store, {
        userId: 911,
        type: NOTIFICATION_TYPE.SYSTEM,
        title: 'Чужое',
        message: 'b',
        eventKey: 'sys:other:1',
      })
      mineId = mine.notification.id
      otherId = other.notification.id
      return true
    })

    const listed = listNotificationsForUser(910, { limit: 50 })
    assert.equal(listed.notifications.length, 1)
    assert.equal(listed.notifications[0].id, mineId)
    assert.equal(listed.unreadCount, 1)

    const stolen = markNotificationRead(910, otherId)
    assert.equal(stolen.success, false)
    assert.equal(stolen.code, 'NOT_FOUND')

    const ok = markNotificationRead(910, mineId)
    assert.equal(ok.success, true)
    assert.equal(ok.unreadCount, 0)

    const all = markAllNotificationsRead(910)
    assert.equal(all.success, true)
    assert.equal(all.unreadCount, 0)
  })
})

test('prunes oldest read notifications beyond per-user cap', () => {
  const store = makeStore({ id: 920, first_name: 'P', username: 'p920' })
  for (let i = 0; i < MAX_NOTIFICATIONS_PER_USER + 5; i += 1) {
    const result = createNotificationOnStore(store, {
      userId: 920,
      type: NOTIFICATION_TYPE.SYSTEM,
      title: `n${i}`,
      message: `m${i}`,
      eventKey: `prune:${i}`,
    })
    assert.equal(result.created, true)
    if (i < MAX_NOTIFICATIONS_PER_USER) {
      store.notifications[result.notification.id].read = true
      store.notifications[result.notification.id].createdAt = new Date(
        Date.UTC(2020, 0, 1) + i * 1000,
      ).toISOString()
    }
  }
  const rows = Object.values(store.notifications).filter((n) => n.userId === 920)
  assert.ok(rows.length <= MAX_NOTIFICATIONS_PER_USER)
  assert.ok(rows.some((n) => !n.read))
})

test('HTTP: notifications require auth; scoped to authenticated user; no client create', async () => {
  await withTempStore(async () => {
    const { app } = await import('./index.mjs')
    const { base, close } = await listen(app)
    try {
      const noAuth = await fetch(`${base}/api/notifications`)
      assert.equal(noAuth.status, 401)

      withStore((store) => {
        createUser(store, { id: 930, first_name: 'Auth', username: 'auth930' })
        createUser(store, { id: 931, first_name: 'Other', username: 'auth931' })
        createNotificationOnStore(store, {
          userId: 930,
          type: NOTIFICATION_TYPE.SYSTEM,
          title: 'Для 930',
          message: 'ok',
          eventKey: 'http:930:1',
        })
        createNotificationOnStore(store, {
          userId: 931,
          type: NOTIFICATION_TYPE.SYSTEM,
          title: 'Для 931',
          message: 'secret',
          eventKey: 'http:931:1',
        })
        return true
      })

      const initData = signInitData(process.env.BOT_TOKEN, {
        auth_date: String(Math.floor(Date.now() / 1000)),
        user: JSON.stringify({ id: 930, first_name: 'Auth', username: 'auth930' }),
      })

      const listRes = await fetch(`${base}/api/notifications?userId=931`, {
        headers: { Authorization: `tma ${initData}` },
      })
      assert.equal(listRes.status, 200)
      const listBody = await listRes.json()
      assert.equal(listBody.success, true)
      assert.equal(listBody.notifications.length, 1)
      assert.equal(listBody.notifications[0].title, 'Для 930')
      assert.equal(listBody.unreadCount, 1)

      const otherId = withStore((store) =>
        Object.values(store.notifications).find((n) => n.userId === 931).id,
      )
      const steal = await fetch(`${base}/api/notifications/${otherId}/read`, {
        method: 'POST',
        headers: {
          Authorization: `tma ${initData}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      assert.equal(steal.status, 404)

      // Client cannot override identity via body (forbidden financial/identity keys).
      const overrideBody = await fetch(`${base}/api/notifications`, {
        method: 'POST',
        headers: {
          Authorization: `tma ${initData}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: 931 }),
      })
      assert.ok(overrideBody.status === 400 || overrideBody.status === 404 || overrideBody.status === 405)

      const createAttempt = await fetch(`${base}/api/notifications/create`, {
        method: 'POST',
        headers: {
          Authorization: `tma ${initData}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'PARTNER_SUBMISSION_APPROVED',
          title: 'fake',
          message: 'fake',
        }),
      })
      assert.ok([404, 405].includes(createAttempt.status) || createAttempt.status >= 400)

      const adminRejectNoKey = await fetch(
        `${base}/api/admin/partners/submissions/does-not-exist/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rejectionReason: 'нет причины без ключа' }),
        },
      )
      assert.ok(adminRejectNoKey.status === 401 || adminRejectNoKey.status === 403)

      const adminRejectEmpty = await withStore((store) => {
        const created = createPartnerSubmissionOnStore(
          store,
          930,
          {
            taskId: 'dragonmoney-task-1',
            partnerAccountId: '9930',
            requestId: 'req-http-reject-eeeeeeee',
          },
          { buffer: pngBuffer(), mimetype: 'image/png' },
        )
        return created.submission.submissionId
      })

      const emptyReason = await fetch(
        `${base}/api/admin/partners/submissions/${adminRejectEmpty}/reject`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Key': process.env.ADMIN_API_KEY,
          },
          body: JSON.stringify({ rejectionReason: '  ' }),
        },
      )
      const emptyBody = await emptyReason.json()
      assert.equal(emptyBody.success, false)
      assert.equal(emptyBody.code, 'MISSING_REJECTION_REASON')

      const okReject = await fetch(
        `${base}/api/admin/partners/submissions/${adminRejectEmpty}/reject`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Key': process.env.ADMIN_API_KEY,
          },
          body: JSON.stringify({
            rejectionReason: 'Скриншот не подтверждает выполнение задания.',
          }),
        },
      )
      const okBody = await okReject.json()
      assert.equal(okBody.success, true)
      assert.match(okBody.submission.rejectionReason, /Скриншот/)

      const after = await fetch(`${base}/api/notifications`, {
        headers: { Authorization: `tma ${initData}` },
      })
      const afterBody = await after.json()
      assert.ok(
        afterBody.notifications.some(
          (n) =>
            n.type === NOTIFICATION_TYPE.PARTNER_SUBMISSION_REJECTED &&
            n.metadata?.rejectionReason?.includes('Скриншот'),
        ),
      )
    } finally {
      await close()
    }
  })
})
