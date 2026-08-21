import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { verifyTelegramInitData } from './auth.mjs'
import { HttpError } from './errors.mjs'
import {
  assertNoClientFinancialOverrides,
  parseCaseId,
  parseRequestId,
} from './validate.mjs'

function signInitData(botToken, fields) {
  const params = new URLSearchParams(fields)
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  params.set('hash', hash)
  return params.toString()
}

test('verifyTelegramInitData accepts valid signed payload', () => {
  const botToken = '123456:TEST_TOKEN'
  const authDate = String(Math.floor(Date.now() / 1000))
  const initData = signInitData(botToken, {
    auth_date: authDate,
    user: JSON.stringify({ id: 42, first_name: 'Test', username: 'tester' }),
    start_param: 'ref_ABCDEF12',
  })

  const result = verifyTelegramInitData(initData, botToken)
  assert.equal(result.user.id, 42)
  assert.equal(result.user.username, 'tester')
  assert.equal(result.startParam, 'ref_ABCDEF12')
})

test('verifyTelegramInitData rejects expired auth_date', () => {
  const botToken = '123456:TEST_TOKEN'
  const authDate = String(Math.floor(Date.now() / 1000) - 60 * 60 - 5)
  const initData = signInitData(botToken, {
    auth_date: authDate,
    user: JSON.stringify({ id: 42, first_name: 'Test' }),
  })

  assert.throws(() => verifyTelegramInitData(initData, botToken), /expired/)
})

test('parseRequestId requires a stable key', () => {
  assert.throws(() => parseRequestId(''), (error) => error instanceof HttpError)
  assert.equal(parseRequestId('abcd1234-efgh'), 'abcd1234-efgh')
})

test('parseCaseId allows only known cases', () => {
  assert.equal(parseCaseId('poor'), 'poor')
  assert.throws(() => parseCaseId('free-money'), (error) => error instanceof HttpError)
})

test('client financial override fields are rejected', () => {
  assert.throws(
    () => assertNoClientFinancialOverrides({ balance: 999999 }),
    (error) => error instanceof HttpError,
  )
  assert.doesNotThrow(() => assertNoClientFinancialOverrides({ productId: 'cash-5000' }))
})
