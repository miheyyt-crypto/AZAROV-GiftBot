import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import dropTables from '../src/data/case-drops.json' with { type: 'json' }

import { getChanceTotal, isDropTableValid, openCase } from './cases.mjs'
import { withStore } from './store.mjs'
import { createUser } from './users.mjs'

test('all production case drop tables sum to exactly 100%', () => {
  for (const [caseId, rewards] of Object.entries(dropTables)) {
    assert.equal(
      getChanceTotal(rewards),
      100,
      `${caseId} drop table must sum to 100%`,
    )
    assert.equal(isDropTableValid(rewards), true)
  }
})

test('openCase heals corrupt array fields instead of 500', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-case-heal-'))
  const prev = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir

  try {
    withStore((store) => {
      const healthy = createUser(store, { id: 101, first_name: 'Ok', username: 'ok' })
      healthy.balance = 50_000

      const brokenInvitee = createUser(store, {
        id: 102,
        first_name: 'Broken',
        username: 'broken',
      })
      // Non-array invitedUsers used to crash migrateAllReferrals for every open.
      brokenInvitee.invitedUsers = { 0: { telegramId: 999, status: 'active' } }

      const opener = createUser(store, { id: 103, first_name: 'Open', username: 'open' })
      opener.balance = 50_000
      opener.caseOpenings = { not: 'an-array' }
      opener.earnedRewards = { also: 'bad' }
      return true
    })

    const result = openCase(103, 'poor', 'heal-corrupt-arrays-01')
    assert.equal(result.success, true, result.message)
    assert.ok(result.opening?.openingId)
    assert.ok(result.opening?.prize?.name)

    withStore(
      (store) => {
        const opener = store.users['103']
        assert.ok(Array.isArray(opener.caseOpenings))
        assert.ok(Array.isArray(opener.earnedRewards))
        assert.ok(opener.caseOpenings.length >= 1)
      },
      { readOnly: true },
    )
  } finally {
    if (prev === undefined) {
      delete process.env.AZAROV_STORE_DIR
    } else {
      process.env.AZAROV_STORE_DIR = prev
    }
    rmSync(dir, { recursive: true, force: true })
  }
})
