import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
