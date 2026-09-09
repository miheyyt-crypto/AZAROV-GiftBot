import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  approveCommunityAccessOnStore,
  createCommunityAccessRequestOnStore,
  getCommunityAccessStatusOnStore,
  rejectCommunityAccessOnStore,
} from './community-access.mjs'
import { createEmptyStore, withStore } from './store.mjs'
import { createUser } from './users.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-community-'))
  const previous = process.env.AZAROV_STORE_DIR
  const previousUploads = process.env.AZAROV_UPLOADS_DIR
  process.env.AZAROV_STORE_DIR = dir
  process.env.AZAROV_UPLOADS_DIR = path.join(dir, 'uploads')

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      if (previousUploads === undefined) delete process.env.AZAROV_UPLOADS_DIR
      else process.env.AZAROV_UPLOADS_DIR = previousUploads
      rmSync(dir, { recursive: true, force: true })
    })
}

/** Minimal valid 1x1 PNG */
function tinyPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W5a0AAAAASUVORK5CYII=',
    'base64',
  )
}

function seedUser(store, id) {
  createUser(store, {
    id,
    first_name: 'Test',
    username: `user${id}`,
    photo_url: '',
  })
}

test('create community access request stores pending status', async () => {
  await withTempStore(async () => {
    const created = withStore((store) => {
      seedUser(store, 501)
      return createCommunityAccessRequestOnStore(
        store,
        { id: 501, username: 'secretuser', first_name: 'Ann' },
        { welvuraId: '123456', username: 'secretuser', requestId: 'req-community-1' },
        { buffer: tinyPng(), mimetype: 'image/png', originalname: 'shot.png' },
      )
    })
    assert.equal(created.success, true)
    assert.equal(created.request.status, 'pending')
    assert.equal(created.request.telegramId, 501)
    assert.equal(created.request.username, 'secretuser')
    assert.equal(created.request.welvuraId, '123456')
    assert.ok(created.request.id)
  })
})

test('duplicate pending community request is blocked', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      seedUser(store, 502)
      createCommunityAccessRequestOnStore(
        store,
        { id: 502, username: 'dupuser', first_name: 'Bob' },
        { welvuraId: '111', username: 'dupuser', requestId: 'req-a' },
        { buffer: tinyPng(), mimetype: 'image/png', originalname: 'a.png' },
      )
      const second = createCommunityAccessRequestOnStore(
        store,
        { id: 502, username: 'dupuser', first_name: 'Bob' },
        { welvuraId: '222', username: 'dupuser', requestId: 'req-b' },
        { buffer: tinyPng(), mimetype: 'image/png', originalname: 'b.png' },
      )
      assert.equal(second.success, false)
      assert.equal(second.code, 'PENDING_EXISTS')
    })
  })
})

test('approve and reject community access update status', async () => {
  await withTempStore(async () => {
    const id = withStore((store) => {
      seedUser(store, 503)
      const created = createCommunityAccessRequestOnStore(
        store,
        { id: 503, username: 'winner', first_name: 'Cat' },
        { welvuraId: '999001', username: 'winner', requestId: 'req-c' },
        { buffer: tinyPng(), mimetype: 'image/png', originalname: 'c.png' },
      )
      return created.request.id
    })

    const approved = withStore((store) => approveCommunityAccessOnStore(store, id, 'tg:1'))
    assert.equal(approved.success, true)
    assert.equal(approved.request.status, 'approved')
    assert.ok(approved.request.reviewedAt)
    assert.equal(withStore((store) => store.users['503'].welvuraVerified), true)

    const status = withStore((store) => getCommunityAccessStatusOnStore(store, 503))
    assert.equal(status.request.status, 'approved')
    assert.equal(status.canSubmit, false)
  })

  await withTempStore(async () => {
    const id = withStore((store) => {
      seedUser(store, 504)
      return createCommunityAccessRequestOnStore(
        store,
        { id: 504, username: 'loser', first_name: 'Dan' },
        { welvuraId: '999002', username: 'loser', requestId: 'req-d' },
        { buffer: tinyPng(), mimetype: 'image/png', originalname: 'd.png' },
      ).request.id
    })

    const rejected = withStore((store) =>
      rejectCommunityAccessOnStore(store, id, 'tg:1', 'Недостаточно данных'),
    )
    assert.equal(rejected.success, true)
    assert.equal(rejected.request.status, 'rejected')

    const status = withStore((store) => getCommunityAccessStatusOnStore(store, 504))
    assert.equal(status.canSubmit, true)

    const again = withStore((store) =>
      createCommunityAccessRequestOnStore(
        store,
        { id: 504, username: 'loser', first_name: 'Dan' },
        { welvuraId: '999003', username: 'loser', requestId: 'req-d2' },
        { buffer: tinyPng(), mimetype: 'image/png', originalname: 'd2.png' },
      ),
    )
    assert.equal(again.success, true)
    assert.equal(again.request.status, 'pending')
  })
})

test('createEmptyStore includes communityAccessRequests at v9', () => {
  const store = createEmptyStore()
  assert.equal(store.version, 13)
  assert.ok(store.communityAccessRequests)
})

test('username validation rejects short names', async () => {
  await withTempStore(async () => {
    const result = withStore((store) => {
      seedUser(store, 505)
      return createCommunityAccessRequestOnStore(
        store,
        { id: 505, first_name: 'Eve' },
        { welvuraId: '555', username: 'ab', requestId: 'req-e' },
        { buffer: tinyPng(), mimetype: 'image/png', originalname: 'e.png' },
      )
    })
    assert.equal(result.success, false)
    assert.equal(result.code, 'INVALID_USERNAME')
  })
})

test('welvuraId is required and must be numeric', async () => {
  await withTempStore(async () => {
    const missing = withStore((store) => {
      seedUser(store, 506)
      return createCommunityAccessRequestOnStore(
        store,
        { id: 506, username: 'validuser', first_name: 'Fay' },
        { username: 'validuser', requestId: 'req-f1' },
        { buffer: tinyPng(), mimetype: 'image/png', originalname: 'f1.png' },
      )
    })
    assert.equal(missing.success, false)
    assert.equal(missing.code, 'INVALID_WELVURA_ID')

    const bad = withStore((store) => {
      seedUser(store, 507)
      return createCommunityAccessRequestOnStore(
        store,
        { id: 507, username: 'validuser', first_name: 'Gus' },
        { welvuraId: 'abc', username: 'validuser', requestId: 'req-f2' },
        { buffer: tinyPng(), mimetype: 'image/png', originalname: 'f2.png' },
      )
    })
    assert.equal(bad.success, false)
    assert.equal(bad.code, 'INVALID_WELVURA_ID')
  })
})
