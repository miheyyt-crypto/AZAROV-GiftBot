import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

/**
 * Mirrors POST /api/cases/open handler body after auth/validation:
 * bootstrapUser → openCase → toPublicUser(getUser)
 */
async function runCaseOpenChain(userId, caseId, requestId) {
  const { bootstrapUser } = await import('./referrals.mjs')
  const { openCase } = await import('./cases.mjs')
  const { getUser } = await import('./store.mjs')
  const { toPublicUser } = await import('./users.mjs')

  bootstrapUser(
    { id: userId, first_name: 'Chain', username: 'chain' },
    '',
  )
  const result = openCase(userId, caseId, requestId)
  const user = toPublicUser(getUser(userId))
  const payload = { ...result, user }
  // Ensure Express-like JSON serialization succeeds.
  JSON.stringify(payload)
  return payload
}

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-case-chain-'))
  const prev = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir
  return (async () => {
    try {
      await run()
    } finally {
      if (prev === undefined) {
        delete process.env.AZAROV_STORE_DIR
      } else {
        process.env.AZAROV_STORE_DIR = prev
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })()
}

test('case-open chain success returns opening + user contract for reel', async () => {
  await withTempStore(async () => {
    const { withStore } = await import('./store.mjs')
    const { createUser } = await import('./users.mjs')

    withStore((store) => {
      const user = createUser(store, { id: 8001, first_name: 'A', username: 'a' })
      user.balance = 50_000
      return true
    })

    const payload = await runCaseOpenChain(8001, 'poor', 'chain-success-01')
    assert.equal(payload.success, true)
    assert.ok(payload.opening)
    assert.ok(payload.opening.openingId)
    assert.ok(payload.opening.rewardId)
    assert.ok(payload.opening.prize)
    assert.equal(typeof payload.opening.prize.id, 'string')
    assert.equal(typeof payload.opening.prize.name, 'string')
    assert.equal(typeof payload.opening.prize.amount, 'number')
    assert.ok(['COINS', 'RUB'].includes(payload.opening.prize.currency))
    assert.ok(payload.user)
    assert.equal(typeof payload.user.balance, 'number')
  })
})

test('case-open chain insufficient funds is controlled', async () => {
  await withTempStore(async () => {
    const { withStore } = await import('./store.mjs')
    const { createUser } = await import('./users.mjs')

    withStore((store) => {
      const user = createUser(store, { id: 8002, first_name: 'B', username: 'b' })
      user.balance = 10
      return true
    })

    const payload = await runCaseOpenChain(8002, 'poor', 'chain-funds-01')
    assert.equal(payload.success, false)
    assert.equal(payload.code, 'INSUFFICIENT_FUNDS')
    assert.equal(payload.opening, undefined)
  })
})

test('case-open chain unknown case returns controlled failure', async () => {
  await withTempStore(async () => {
    const { withStore } = await import('./store.mjs')
    const { createUser } = await import('./users.mjs')
    const { openCase } = await import('./cases.mjs')

    withStore((store) => {
      createUser(store, { id: 8003, first_name: 'C', username: 'c' })
      return true
    })

    const result = openCase(8003, 'not-a-case', 'chain-badcase-01')
    assert.equal(result.success, false)
    assert.match(result.message, /не найден/i)
  })
})

test('case-open chain survives malformed array fields', async () => {
  await withTempStore(async () => {
    const { withStore } = await import('./store.mjs')
    const { createUser } = await import('./users.mjs')

    withStore((store) => {
      const healthy = createUser(store, { id: 8004, first_name: 'D', username: 'd' })
      healthy.balance = 50_000
      healthy.caseOpenings = { x: 1 }
      healthy.earnedRewards = { y: 1 }
      healthy.invitedUsers = { 0: { telegramId: 9, status: 'active' } }
      healthy.completedTasks = { z: 1 }

      // Corrupt neighbor must not break migrateAllReferrals for opener.
      const neighbor = createUser(store, { id: 8005, first_name: 'E', username: 'e' })
      neighbor.invitedUsers = { broken: true }
      neighbor.completedTasks = { broken: true }
      return true
    })

    const payload = await runCaseOpenChain(8004, 'poor', 'chain-malformed-01')
    assert.equal(payload.success, true)
    assert.ok(payload.opening?.openingId)
  })
})

test('empty reward pool is invalid drop table (controlled)', async () => {
  const cases = await import('./cases.mjs')
  assert.equal(cases.isDropTableValid([]), false)
  assert.equal(cases.getChanceTotal([]), 0)
})
