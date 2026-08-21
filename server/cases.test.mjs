import assert from 'node:assert/strict'
import test from 'node:test'

import dropTables from '../src/data/case-drops.json' with { type: 'json' }

import { getChanceTotal, isDropTableValid } from './cases.mjs'

test('poor, rich and referral drop tables sum to 100%', () => {
  assert.equal(getChanceTotal(dropTables.poor), 100)
  assert.equal(isDropTableValid(dropTables.poor), true)
  assert.equal(getChanceTotal(dropTables.rich), 100)
  assert.equal(isDropTableValid(dropTables.rich), true)
  assert.equal(getChanceTotal(dropTables.referral), 100)
  assert.equal(isDropTableValid(dropTables.referral), true)
})

test('medium drop table currently sums to 101% and must not roll', () => {
  assert.equal(getChanceTotal(dropTables.medium), 101)
  assert.equal(isDropTableValid(dropTables.medium), false)
})
