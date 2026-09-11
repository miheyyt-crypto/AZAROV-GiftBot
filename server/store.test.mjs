import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('corrupt store.json fails closed and does not wipe data', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-store-'))
  process.env.AZAROV_STORE_DIR = dir

  try {
    const storePath = path.join(dir, 'store.json')
    writeFileSync(storePath, '{not-json', 'utf8')

    // Fresh module instance bound to AZAROV_STORE_DIR.
    const { loadStore, StoreCorruptError, withStore } = await import(
      `./store.mjs?t=${Date.now()}`
    )

    assert.throws(() => loadStore(), (error) => error instanceof StoreCorruptError)
    assert.throws(
      () =>
        withStore((store) => {
          store.users['1'] = { telegramId: 1 }
          return true
        }),
      (error) => error instanceof StoreCorruptError,
    )

    assert.equal(readFileSync(storePath, 'utf8'), '{not-json')
    assert.ok(existsSync(storePath))
  } finally {
    delete process.env.AZAROV_STORE_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})

test('withStoreRead does not rewrite store file', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-store-'))
  process.env.AZAROV_STORE_DIR = dir

  try {
    mkdirSync(dir, { recursive: true })
    const storePath = path.join(dir, 'store.json')
    const initial = JSON.stringify(
      {
        version: 3,
        users: {},
        referralIndex: {},
        referrals: {},
        events: {},
        coinTransactions: {},
        orders: {},
        caseOpenings: {},
        partnerSubmissions: {},
        partnerAccountBinds: {},
      },
      null,
      2,
    )
    writeFileSync(storePath, initial, 'utf8')

    const { withStore, withStoreRead } = await import(`./store.mjs?t=${Date.now() + 1}`)

    withStore((store) => {
      store.users['7'] = { telegramId: 7, balance: 1 }
      return true
    })
    const afterWrite = readFileSync(storePath, 'utf8')

    withStoreRead((store) => {
      assert.equal(store.users['7'].balance, 1)
      store.users['7'].balance = 999
      return true
    })

    assert.equal(readFileSync(storePath, 'utf8'), afterWrite)
  } finally {
    delete process.env.AZAROV_STORE_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})

test('saveStore writes rotating .bak and restores when primary missing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-store-bak-'))
  process.env.AZAROV_STORE_DIR = dir

  try {
    const { withStore, loadStore } = await import(`./store.mjs?t=${Date.now() + 2}`)
    const storePath = path.join(dir, 'store.json')
    const bakPath = `${storePath}.bak`

    withStore((store) => {
      store.users['42'] = { telegramId: 42, balance: 500, completedTasks: ['telegram-subscribe'] }
      return true
    })

    assert.ok(existsSync(bakPath))
    const bak = JSON.parse(readFileSync(bakPath, 'utf8'))
    assert.equal(bak.users['42'].balance, 500)

    rmSync(storePath, { force: true })
    assert.equal(existsSync(storePath), false)

    const restored = loadStore()
    assert.equal(restored.users['42'].balance, 500)
    assert.deepEqual(restored.users['42'].completedTasks, ['telegram-subscribe'])
    assert.ok(existsSync(storePath))
  } finally {
    delete process.env.AZAROV_STORE_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})

test('corrupt primary falls back to .bak', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-store-bak2-'))
  process.env.AZAROV_STORE_DIR = dir

  try {
    const { withStore, loadStore } = await import(`./store.mjs?t=${Date.now() + 3}`)
    const storePath = path.join(dir, 'store.json')

    withStore((store) => {
      store.users['9'] = { telegramId: 9, balance: 77 }
      return true
    })

    writeFileSync(storePath, '{broken', 'utf8')
    const restored = loadStore()
    assert.equal(restored.users['9'].balance, 77)
  } finally {
    delete process.env.AZAROV_STORE_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})

test('isPersistentStoreDir treats project server/data as ephemeral', async () => {
  const previous = process.env.AZAROV_STORE_DIR
  delete process.env.AZAROV_STORE_DIR

  try {
    const { getDataDir, isPersistentStoreDir } = await import(`./store.mjs?t=${Date.now() + 4}`)
    const dir = getDataDir()
    assert.equal(isPersistentStoreDir(dir), false)
    assert.match(dir.replace(/\\/g, '/'), /server\/data$/)
  } finally {
    if (previous === undefined) {
      delete process.env.AZAROV_STORE_DIR
    } else {
      process.env.AZAROV_STORE_DIR = previous
    }
  }
})

test('deferPersist batches disk writes and flushStoreNow persists', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-store-defer-'))
  process.env.AZAROV_STORE_DIR = dir
  process.env.AZAROV_STORE_DEFER_MS = '30_000'

  try {
    const { withStore, withStoreRead, flushStoreNow } = await import(
      `./store.mjs?t=${Date.now() + 5}`
    )
    const storePath = path.join(dir, 'store.json')

    withStore((store) => {
      store.users['1'] = { telegramId: 1, balance: 10 }
      return true
    })
    const afterImmediate = readFileSync(storePath, 'utf8')

    withStore(
      (store) => {
        store.users['1'].balance = 99
        return true
      },
      { deferPersist: true },
    )

    // Disk still has previous snapshot until flush.
    assert.equal(readFileSync(storePath, 'utf8'), afterImmediate)
    // In-memory readers see the hot update.
    assert.equal(
      withStoreRead((store) => store.users['1'].balance),
      99,
    )

    flushStoreNow()
    const persisted = JSON.parse(readFileSync(storePath, 'utf8'))
    assert.equal(persisted.users['1'].balance, 99)
  } finally {
    delete process.env.AZAROV_STORE_DIR
    delete process.env.AZAROV_STORE_DEFER_MS
    rmSync(dir, { recursive: true, force: true })
  }
})

test('withStore skipUnchangedPersist via __storeDirty false skips rewrite', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-store-skip-'))
  process.env.AZAROV_STORE_DIR = dir

  try {
    const { withStore } = await import(`./store.mjs?t=${Date.now() + 6}`)
    const storePath = path.join(dir, 'store.json')

    withStore((store) => {
      store.users['2'] = { telegramId: 2, balance: 5 }
      return true
    })
    const before = readFileSync(storePath, 'utf8')
    const mtimeBefore = Number(statSync(storePath).mtimeMs)

    await new Promise((r) => setTimeout(r, 20))

    withStore((store) => {
      // Touch memory but ask to skip persist.
      store.users['2'].balance = 5
      return { __storeDirty: false, ok: true }
    })

    assert.equal(readFileSync(storePath, 'utf8'), before)
    const mtimeAfter = Number(statSync(storePath).mtimeMs)
    assert.equal(mtimeAfter, mtimeBefore)
  } finally {
    delete process.env.AZAROV_STORE_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})
