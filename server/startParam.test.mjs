import assert from 'node:assert/strict'
import test from 'node:test'

import { extractReferralCode, resolveReferralStartParam } from './users.mjs'

/**
 * Mirrors frontend startParam extraction from signed initData / launch URL.
 * Keeps the server contract aligned with Telegram Mini Apps launch params.
 */
function extractStartParamFromInitData(initData) {
  return new URLSearchParams(initData).get('start_param')?.trim() || ''
}

function extractStartParamFromLocation(search, hash) {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const fromQuery =
    query.get('tgWebAppStartParam')?.trim() || query.get('startapp')?.trim() || ''
  if (fromQuery) {
    return fromQuery
  }

  const rawHash = String(hash || '').replace(/^#/, '')
  if (!rawHash) {
    return ''
  }
  const hashParams = new URLSearchParams(rawHash.startsWith('?') ? rawHash.slice(1) : rawHash)
  return (
    hashParams.get('tgWebAppStartParam')?.trim() ||
    hashParams.get('startapp')?.trim() ||
    ''
  )
}

test('start_param ref_LMEK2RC6 is extracted from signed initData', () => {
  const initData = [
    'user=%7B%22id%22%3A1%7D',
    'auth_date=1710000000',
    'start_param=ref_LMEK2RC6',
    'hash=abc',
  ].join('&')

  assert.equal(extractStartParamFromInitData(initData), 'ref_LMEK2RC6')
  assert.equal(extractReferralCode('ref_LMEK2RC6'), 'LMEK2RC6')
})

test('tgWebAppStartParam from hash launch params is accepted', () => {
  const hash =
    'tgWebAppData=user%3D1&tgWebAppVersion=8.0&tgWebAppPlatform=ios&tgWebAppStartParam=ref_LMEK2RC6'
  assert.equal(extractStartParamFromLocation('', `#${hash}`), 'ref_LMEK2RC6')
})

test('startapp query on WEBAPP_URL is accepted', () => {
  assert.equal(
    extractStartParamFromLocation('?startapp=ref_LMEK2RC6', ''),
    'ref_LMEK2RC6',
  )
})

test('resolve prefers signed initData over client for ref_LMEK2RC6', () => {
  const resolved = resolveReferralStartParam({
    signed: 'ref_LMEK2RC6',
    client: 'ref_OTHER123',
    pending: '',
  })
  assert.equal(resolved.source, 'init_data')
  assert.equal(extractReferralCode(resolved.value), 'LMEK2RC6')
})
