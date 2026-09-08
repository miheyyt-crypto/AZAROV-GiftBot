import assert from 'node:assert/strict'
import test from 'node:test'

import { createUser } from './users.mjs'
import { createEmptyStore } from './store.mjs'
import {
  approvePartnerSubmissionOnStore,
  createPartnerSubmissionOnStore,
  rejectPartnerSubmissionOnStore,
} from './partner-submissions.mjs'
import { validatePartnerAccountId, findPartner } from './partners.mjs'
import { detectImageType } from './uploads.mjs'

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

test('partner account id accepts digits only', () => {
  const partner = findPartner('dragonmoney')
  assert.equal(validatePartnerAccountId(partner, '12345').ok, true)
  assert.equal(validatePartnerAccountId(partner, 'abc').ok, false)
  assert.equal(validatePartnerAccountId(partner, '<script>').ok, false)
})

test('detectImageType recognizes png magic bytes', () => {
  const type = detectImageType(pngBuffer())
  assert.equal(type?.ext, 'png')
  assert.equal(type?.mime, 'image/png')
})

test('hidden partner submissions are rejected', () => {
  const store = makeStore({ id: 500, first_name: 'H', username: 'hidden' })
  const created = createPartnerSubmissionOnStore(
    store,
    500,
    {
      taskId: 'stake-task-1',
      partnerAccountId: '998877',
      requestId: 'req-hidden-partner-01',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(created.success, false)
  assert.equal(created.code, 'PARTNER_UNAVAILABLE')
  assert.equal(store.users['500'].balance, 0)
})

test('hidden partner cannot be started, verified for reward, or listed publicly', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { startPartnerTask, verifyPartnerTask } = await import('./partner-tasks.mjs')
  const { listPartnersPublic } = await import('./partners.mjs')
  const { createUser } = await import('./users.mjs')
  const { withStore } = await import('./store.mjs')

  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-partner-hidden-'))
  const previous = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir
  try {
    withStore((store) => {
      createUser(store, { id: 510, first_name: 'S', username: 'stake' })
      return true
    })

    const started = startPartnerTask(510, 'stake-task-1')
    assert.equal(started.success, false)
    assert.equal(started.code, 'PARTNER_UNAVAILABLE')

    const verified = verifyPartnerTask()
    assert.equal(verified.success, false)
    assert.equal(verified.code, 'MANUAL_REVIEW_REQUIRED')

    const publicIds = listPartnersPublic().map((p) => p.id)
    assert.equal(publicIds.includes('stake'), false)
    assert.ok(publicIds.includes('dragonmoney'))

    withStore((store) => {
      assert.equal(store.users['510'].balance, 0)
      assert.equal((store.users['510'].completedTasks || []).includes('stake-task-1'), false)
      return true
    })
  } finally {
    if (previous === undefined) delete process.env.AZAROV_STORE_DIR
    else process.env.AZAROV_STORE_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

test('submission does not grant coins until approve', () => {
  const store = makeStore({ id: 501, first_name: 'P', username: 'puser' })

  const created = createPartnerSubmissionOnStore(
    store,
    501,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '998877',
      requestId: 'req-partner-1aaaaaaaa',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )

  assert.equal(created.success, true)
  assert.equal(created.submission.status, 'pending')
  assert.equal(store.users['501'].balance, 0)
  assert.equal(store.users['501'].completedTasks.includes('dragonmoney-task-1'), false)

  const approved = approvePartnerSubmissionOnStore(
    store,
    created.submission.submissionId,
    'tester',
    'approve-1',
  )
  assert.equal(approved.success, true)
  assert.equal(approved.submission.status, 'approved')
  assert.equal(store.users['501'].balance, 1000)
  assert.equal(store.users['501'].completedTasks.includes('dragonmoney-task-1'), true)

  const rewardTx = Object.values(store.coinTransactions).find(
    (item) => item.type === 'partner_reward' && item.userId === 501,
  )
  assert.ok(rewardTx)
  assert.equal(rewardTx.amount, 1000)
  assert.match(String(rewardTx.description || ''), /Welvura/)

  const second = createPartnerSubmissionOnStore(
    store,
    501,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '998877',
      requestId: 'req-partner-2bbbbbbbb',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(second.success, false)
})

test('rejected submission can be resent; pending blocks duplicates', () => {
  const store = makeStore({ id: 777, first_name: 'R', username: 'ruser' })

  const first = createPartnerSubmissionOnStore(
    store,
    777,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '111',
      requestId: 'req-reject-1cccccccc',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(first.success, true)

  const duplicate = createPartnerSubmissionOnStore(
    store,
    777,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '111',
      requestId: 'req-reject-2dddddddd',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(duplicate.success, false)
  assert.equal(duplicate.code, 'PENDING_EXISTS')

  const rejected = rejectPartnerSubmissionOnStore(
    store,
    first.submission.submissionId,
    'admin',
    'Плохой скрин',
    'reject-1',
  )
  assert.equal(rejected.success, true)
  assert.equal(rejected.submission.status, 'rejected')
  assert.equal(rejected.submission.rejectionReason, 'Плохой скрин')
  assert.ok(rejected.submission.reviewedAt)

  const again = createPartnerSubmissionOnStore(
    store,
    777,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '111',
      requestId: 'req-reject-3eeeeeeee',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(again.success, true)
  assert.equal(again.submission.status, 'pending')
  assert.notEqual(again.submission.submissionId, first.submission.submissionId)

  // Old rejected screenshot must be safely removed on resubmit (one primary file).
  const oldRecord = store.partnerSubmissions[first.submission.submissionId]
  assert.equal(oldRecord.screenshotPath, null)
  assert.ok(oldRecord.screenshotDeletedAt)
})

test('same partner account cannot bind to another telegram user', () => {
  const store = makeStore(
    { id: 10, first_name: 'A', username: 'a' },
    { id: 20, first_name: 'B', username: 'b' },
  )

  const first = createPartnerSubmissionOnStore(
    store,
    10,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '555',
      requestId: 'req-bind-1ffffffffff',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(first.success, true)
  assert.equal(
    approvePartnerSubmissionOnStore(store, first.submission.submissionId, 'admin').success,
    true,
  )

  const stolen = createPartnerSubmissionOnStore(
    store,
    20,
    {
      taskId: 'dragonmoney-task-1',
      partnerAccountId: '555',
      requestId: 'req-bind-2gggggggggg',
    },
    { buffer: pngBuffer(), mimetype: 'image/png' },
  )
  assert.equal(stolen.success, false)
  assert.equal(stolen.code, 'ACCOUNT_TAKEN')
})
