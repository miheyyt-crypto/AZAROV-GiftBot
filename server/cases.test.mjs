import assert from 'node:assert/strict'
import test from 'node:test'

import dropTables from '../src/data/case-drops.json' with { type: 'json' }

import { getChanceTotal, isDropTableValid } from './cases.mjs'

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
