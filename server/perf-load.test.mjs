import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

/**
 * Smoke load: concurrent GET-style store reads must not take exclusive write locks
 * and must finish quickly even when a deferred writer is active.
 */
test('concurrent withStoreRead stays fast under deferred writes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-load-'))
  process.env.AZAROV_STORE_DIR = dir
  process.env.AZAROV_STORE_DEFER_MS = '500'

  try {
    const { withStore, withStoreRead, flushStoreNow } = await import(
      `./store.mjs?t=${Date.now() + 50}`
    )

    withStore((store) => {
      for (let i = 1; i <= 200; i += 1) {
        store.users[String(i)] = {
          telegramId: i,
          balance: i * 10,
          username: `u${i}`,
          firstName: `User${i}`,
        }
      }
      return true
    })

    for (let w = 0; w < 40; w += 1) {
      withStore(
        (store) => {
          const id = String((w % 200) + 1)
          store.users[id].balance = Number(store.users[id].balance) + 1
          return true
        },
        { deferPersist: true },
      )
    }

    const t0 = performance.now()
    const reads = []
    for (let r = 0; r < 100; r += 1) {
      reads.push(withStoreRead((store) => Object.keys(store.users || {}).length))
    }
    const readMs = performance.now() - t0

    assert.equal(reads.every((n) => n === 200), true)
    assert.ok(readMs < 250, `expected concurrent reads <250ms, got ${Math.round(readMs)}ms`)

    flushStoreNow()
  } finally {
    delete process.env.AZAROV_STORE_DIR
    delete process.env.AZAROV_STORE_DEFER_MS
    rmSync(dir, { recursive: true, force: true })
  }
})

test('leaderboard TTL cache returns identical payload within window', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-lb-'))
  process.env.AZAROV_STORE_DIR = dir
  process.env.AZAROV_LEADERBOARD_TTL_MS = '5000'

  try {
    const { withStore } = await import(`./store.mjs?t=${Date.now() + 51}`)
    const { getLeaderboard, clearHomeCaches } = await import(`./home.mjs?t=${Date.now() + 52}`)
    clearHomeCaches()

    withStore((store) => {
      store.users['10'] = {
        telegramId: 10,
        balance: 1000,
        username: 'top',
        firstName: 'Top',
        completedTasks: [],
        invitedUsers: [],
      }
      store.users['11'] = {
        telegramId: 11,
        balance: 500,
        username: 'mid',
        firstName: 'Mid',
        completedTasks: [],
        invitedUsers: [],
      }
      return true
    })

    const a = getLeaderboard(3, { metric: 'balance' })
    const b = getLeaderboard(3, { metric: 'balance' })
    assert.equal(
      a.players[0]?.telegramId || a.players[0]?.id,
      b.players[0]?.telegramId || b.players[0]?.id,
    )
    assert.equal(a.players.length, b.players.length)
  } finally {
    delete process.env.AZAROV_STORE_DIR
    delete process.env.AZAROV_LEADERBOARD_TTL_MS
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Simulate 100 concurrent Mini App warm GETs (bootstrap read-path) while Kick chat
 * mutates store with deferred persistence — must stay responsive.
 */
test('100 concurrent warm bootstrapUsers stay read-only under Kick chat writes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-boot-load-'))
  process.env.AZAROV_STORE_DIR = dir
  process.env.AZAROV_STORE_DEFER_MS = '800'

  try {
    const stamp = Date.now() + 60
    const { withStore, flushStoreNow } = await import(`./store.mjs?t=${stamp}`)
    const { bootstrapUser } = await import(`./referrals.mjs?t=${stamp}`)
    const { createUser } = await import(`./users.mjs?t=${stamp}`)

    withStore((store) => {
      for (let i = 1; i <= 100; i += 1) {
        createUser(store, { id: i, first_name: `U${i}`, username: `user${i}` })
      }
      return true
    })

    for (let w = 0; w < 80; w += 1) {
      withStore(
        (store) => {
          const id = String((w % 100) + 1)
          store.users[id].chatMessages = (Number(store.users[id].chatMessages) || 0) + 1
          store.kickWebhookEvents = store.kickWebhookEvents || {}
          store.kickWebhookEvents[`chat:load:${w}`] = {
            processedAt: new Date().toISOString(),
            outcome: 'load_test',
          }
          return true
        },
        { deferPersist: true },
      )
    }

    const t0 = performance.now()
    const results = []
    for (let i = 1; i <= 100; i += 1) {
      results.push(bootstrapUser({ id: i, first_name: `U${i}`, username: `user${i}` }, ''))
    }
    const ms = performance.now() - t0

    assert.equal(
      results.every((row) => row?.user && row.storePersisted === false),
      true,
    )
    assert.ok(ms < 500, `expected 100 warm bootstraps <500ms, got ${Math.round(ms)}ms`)

    flushStoreNow()
  } finally {
    delete process.env.AZAROV_STORE_DIR
    delete process.env.AZAROV_STORE_DEFER_MS
    rmSync(dir, { recursive: true, force: true })
  }
})
