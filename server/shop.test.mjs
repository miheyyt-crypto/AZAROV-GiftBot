import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeOrderStatus } from './shop.mjs'
import { findProduct } from './products.mjs'

test('normalizeOrderStatus maps legacy and canonical values', () => {
  assert.equal(normalizeOrderStatus('PENDING'), 'pending')
  assert.equal(normalizeOrderStatus('pending'), 'pending')
  assert.equal(normalizeOrderStatus('CANCELLED'), 'cancelled')
  assert.equal(normalizeOrderStatus('rejected'), 'rejected')
})

test('product prices are positive server-side integers', () => {
  const product = findProduct('streak-freeze')
  assert.ok(product)
  assert.equal(Number.isInteger(product.price), true)
  assert.ok(product.price > 0)
})
