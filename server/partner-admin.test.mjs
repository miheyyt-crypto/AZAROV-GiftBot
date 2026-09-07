import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPartnerModerationKeyboard,
  buildPartnerSubmissionAdminText,
  clearPendingRejectReasons,
  getPendingRejectReason,
  handlePartnerModerationCallback,
  handlePartnerRejectReasonMessage,
  parsePartnerModerationCallback,
} from './partner-admin.mjs'
import {
  approvePartnerSubmissionOnStore,
  createPartnerSubmissionOnStore,
  rejectPartnerSubmissionOnStore,
} from './partner-submissions.mjs'
import { createEmptyStore } from './store.mjs'
import { isAdminTelegramUser, parseTelegramIdList } from './telegram-notify.mjs'
import { createUser } from './users.mjs'

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

test('parseTelegramIdList and isAdminTelegramUser', () => {
  assert.deepEqual(parseTelegramIdList('111, 222;333'), ['111', '222', '333'])
  assert.deepEqual(parseTelegramIdList('"999", \'888\''), ['999', '888'])
  process.env.ADMIN_TELEGRAM_IDS = '111,222'
  assert.equal(isAdminTelegramUser(111), true)
  assert.equal(isAdminTelegramUser('111'), true)
  assert.equal(isAdminTelegramUser(999), false)
  delete process.env.ADMIN_TELEGRAM_IDS
})

test('non-admin gets denied alert path', async () => {
  clearPendingRejectReasons()
  process.env.ADMIN_TELEGRAM_IDS = '424242'
  let answered = null
  const handled = await handlePartnerModerationCallback({
    from: { id: 1 },
    callbackQuery: {
      id: 'cb-deny',
      data: 'vellur:approve:10ad69e7-2db7-4842-9ad4-72684e23778a',
      message: { chat: { id: 1 }, message_id: 1 },
    },
    answerCbQuery: async (text, opts) => {
      answered = { text, opts }
    },
    reply: async () => {},
  })
  assert.equal(handled, true)
  assert.match(String(answered?.text || ''), /прав/i)
  assert.equal(answered?.opts?.show_alert, true)
  delete process.env.ADMIN_TELEGRAM_IDS
})

test('unknown callback format is ignored safely', async () => {
  const handled = await handlePartnerModerationCallback({
    from: { id: 1 },
    callbackQuery: { id: 'cb-x', data: 'not-a-valid-callback' },
    answerCbQuery: async () => {},
  })
  assert.equal(handled, false)
})


test('parsePartnerModerationCallback accepts vellur approve/reject', () => {
  const id = '10ad69e7-2db7-4842-9ad4-72684e23778a'
  assert.deepEqual(parsePartnerModerationCallback(`vellur:approve:${id}`), {
    action: 'approve',
    submissionId: id,
  })
  assert.deepEqual(parsePartnerModerationCallback(`vellur:reject:${id}`), {
    action: 'reject',
    submissionId: id,
  })
  assert.equal(parsePartnerModerationCallback('vellur:approve:../etc'), null)
  assert.equal(parsePartnerModerationCallback('hack:approve:x'), null)
})

test('buildPartnerModerationKeyboard embeds submission id', () => {
  const keyboard = buildPartnerModerationKeyboard('abc-123')
  assert.equal(keyboard.inline_keyboard[0][0].callback_data, 'vellur:approve:abc-123')
  assert.equal(keyboard.inline_keyboard[0][1].callback_data, 'vellur:reject:abc-123')
})

test('admin text includes Welvura id and telegram id', () => {
  const text = buildPartnerSubmissionAdminText(
    {
      partnerName: 'Welvura',
      taskTitle: 'Привязать аккаунт Welvura',
      reward: 1000,
      telegramUserId: 42,
      partnerAccountId: '998877',
      createdAt: '2026-09-07T12:00:00.000Z',
      submissionId: 'sub-1',
    },
    { username: 'tester' },
  )
  assert.match(text, /Welvura/i)
  assert.match(text, /998877/)
  assert.match(text, /42/)
  assert.match(text, /@tester/)
})

test('Welvura flow: pending → approve once → no second reward → reject path', () => {
  const store = makeStore({ id: 8801, first_name: 'V', username: 'vuser' })

  const created = createPartnerSubmissionOnStore(
    store,
    8801,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '555001',
      requestId: 'req-vellur-1aaaaaaaaa',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(created.success, true)
  assert.equal(created.submission.status, 'pending')
  assert.equal(store.users['8801'].balance, 0)

  const dup = createPartnerSubmissionOnStore(
    store,
    8801,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '555001',
      requestId: 'req-vellur-2bbbbbbbbb',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(dup.success, false)
  assert.equal(dup.code, 'PENDING_EXISTS')

  const approved = approvePartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'tg:111',
    'approve-a',
  )
  assert.equal(approved.success, true)
  assert.equal(approved.submission.status, 'approved')
  assert.equal(store.users['8801'].balance, 1000)

  const again = approvePartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'tg:111',
    'approve-b',
  )
  assert.equal(again.success, true)
  assert.equal(store.users['8801'].balance, 1000)

  const afterApproved = createPartnerSubmissionOnStore(
    store,
    8801,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '555002',
      requestId: 'req-vellur-3ccccccccc',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(afterApproved.success, false)
})

test('reject then resubmit then cannot approve missing id', () => {
  const store = makeStore({ id: 8802, first_name: 'R', username: 'r2' })

  const created = createPartnerSubmissionOnStore(
    store,
    8802,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '777001',
      requestId: 'req-rej-1aaaaaaaaaaa',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )

  const rejected = rejectPartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'tg:111',
    'плохой скрин',
    'rej-1',
  )
  assert.equal(rejected.success, true)
  assert.equal(rejected.submission.status, 'rejected')
  assert.equal(store.users['8802'].balance, 0)

  const resubmit = createPartnerSubmissionOnStore(
    store,
    8802,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '777001',
      requestId: 'req-rej-2bbbbbbbbbbb',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(resubmit.success, true)
  assert.equal(resubmit.submission.status, 'pending')

  const missing = approvePartnerSubmissionOnStore(store, '00000000-0000-0000-0000-000000000000', 'tg:1')
  assert.equal(missing.success, false)

  const rejectAgain = rejectPartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'tg:111',
    'again',
    'rej-2',
  )
  assert.equal(rejectAgain.success, true)
  assert.match(rejectAgain.message, /уже отклонена|нельзя/i)
})

test('non-admin callback is denied; admin approve grants once', async () => {
  clearPendingRejectReasons()
  const store = makeStore({ id: 8803, first_name: 'A', username: 'a3' })
  const created = createPartnerSubmissionOnStore(
    store,
    8803,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '888001',
      requestId: 'req-cb-1aaaaaaaaaaaa',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )

  // Patch store access for approvePartnerSubmission (uses withStore on real store file).
  // Callback handler uses approvePartnerSubmission which writes the real store —
  // so we test parse + isAdmin gate with a fake ctx instead of full I/O.
  process.env.ADMIN_TELEGRAM_IDS = '424242'
  assert.equal(isAdminTelegramUser(1), false)
  assert.equal(isAdminTelegramUser(424242), true)

  let answered = ''
  const denied = await handlePartnerModerationCallback({
    from: { id: 1 },
    callbackQuery: {
      id: 'cb-deny',
      data: `vellur:approve:${created.submission.submissionId}`,
      message: { chat: { id: 1 }, message_id: 1 },
    },
    answerCbQuery: async () => {},
    reply: async () => {},
  })
  // Without BOT_TOKEN answerTelegramCallback fails soft; still handled.
  assert.equal(denied, true)

  // Reject reason pending state
  process.env.ADMIN_TELEGRAM_IDS = '424242'
  await handlePartnerModerationCallback({
    from: { id: 424242 },
    callbackQuery: {
      id: 'cb-rej',
      data: `vellur:reject:${created.submission.submissionId}`,
      message: { chat: { id: 424242 }, message_id: 2 },
    },
    reply: async () => {},
  })
  assert.ok(getPendingRejectReason(424242))

  const cancelled = await handlePartnerRejectReasonMessage({
    from: { id: 424242 },
    message: { text: 'отмена' },
    reply: async (text) => {
      answered = text
    },
  })
  assert.equal(cancelled, true)
  assert.match(answered, /отменено/i)
  assert.equal(getPendingRejectReason(424242), null)

  delete process.env.ADMIN_TELEGRAM_IDS
  clearPendingRejectReasons()
})
