import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createEmptyStore, withStore } from './store.mjs'
import { createUser } from './users.mjs'
import {
  BROADCAST_STATUS,
  cancelBroadcastDraft,
  createBroadcastDraftOnStore,
  listBroadcastRecipients,
  queueBroadcast,
} from './broadcasts.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-bc-'))
  const previous = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.AZAROV_STORE_DIR
    else process.env.AZAROV_STORE_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

test('store includes broadcasts map', () => {
  const store = createEmptyStore()
  assert.equal(store.version, 23)
  assert.ok(store.broadcasts)
})

test('recipients skip botBlocked users (account bans removed)', () => {
  withTempStore(() => {
    const ids = withStore((store) => {
      createUser(store, { id: 1, first_name: 'A', username: 'a' })
      createUser(store, { id: 2, first_name: 'B', username: 'b' })
      createUser(store, { id: 3, first_name: 'C', username: 'c' })
      store.users['2'].blocked = true
      store.users['3'].botBlocked = true
      return listBroadcastRecipients(store)
    })
    assert.deepEqual(ids, [1, 2])
  })
})

test('draft create + atomic queue once', () => {
  withTempStore(() => {
    withStore((store) => {
      createUser(store, { id: 10, first_name: 'U', username: 'u10' })
      createUser(store, { id: 11, first_name: 'V', username: 'u11' })
    })

    const draft = withStore((store) =>
      createBroadcastDraftOnStore(store, {
        adminId: 999,
        contentType: 'text',
        sourceChatId: 999,
        sourceMessageId: 55,
        textPreview: 'hello',
      }),
    )
    assert.equal(draft.success, true)
    assert.equal(draft.broadcast.status, BROADCAST_STATUS.DRAFT)
    assert.equal(draft.broadcast.total, 2)

    const first = queueBroadcast(draft.broadcast.id, 999, { chatId: 999, messageId: 100 })
    assert.equal(first.success, true)
    assert.equal(first.broadcast.status, BROADCAST_STATUS.QUEUED)

    const second = queueBroadcast(draft.broadcast.id, 999, { chatId: 999, messageId: 101 })
    assert.equal(second.success, false)
    assert.equal(second.code, 'ALREADY_STARTED')
  })
})

test('cancel draft deletes it', () => {
  withTempStore(() => {
    withStore((store) => {
      createUser(store, { id: 20, first_name: 'U', username: 'u20' })
    })
    const draft = withStore((store) =>
      createBroadcastDraftOnStore(store, {
        adminId: 42,
        contentType: 'photo',
        sourceChatId: 42,
        sourceMessageId: 7,
        textPreview: 'cap',
      }),
    )
    const cancelled = cancelBroadcastDraft(draft.broadcast.id, 42)
    assert.equal(cancelled.success, true)
    assert.equal(cancelled.deleted, true)
    assert.equal(
      withStore((store) => store.broadcasts[draft.broadcast.id]),
      undefined,
    )
  })
})
