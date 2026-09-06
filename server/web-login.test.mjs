import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { verifyTelegramLoginWidget } from './auth.mjs'

function signLoginWidget(botToken, fields) {
  const entries = Object.entries(fields)
    .filter(([key]) => key !== 'hash')
    .map(([key, value]) => [key, String(value)])
    .sort(([a], [b]) => a.localeCompare(b))

  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join('\n')
  const secretKey = crypto.createHash('sha256').update(botToken).digest()
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  return { ...fields, hash }
}

test('verifyTelegramLoginWidget accepts valid widget payload', () => {
  const botToken = '123456:WEB_LOGIN_TOKEN'
  const payload = signLoginWidget(botToken, {
    id: 777,
    first_name: 'Web',
    username: 'webuser',
    auth_date: Math.floor(Date.now() / 1000),
  })

  const result = verifyTelegramLoginWidget(payload, botToken)
  assert.equal(result.user.id, 777)
  assert.equal(result.user.username, 'webuser')
})

test('verifyTelegramLoginWidget rejects tampered id', () => {
  const botToken = '123456:WEB_LOGIN_TOKEN'
  const payload = signLoginWidget(botToken, {
    id: 777,
    first_name: 'Web',
    auth_date: Math.floor(Date.now() / 1000),
  })
  payload.id = 999

  assert.throws(() => verifyTelegramLoginWidget(payload, botToken), /invalid_hash/)
})

test('verifyTelegramLoginWidget rejects expired auth_date', () => {
  const botToken = '123456:WEB_LOGIN_TOKEN'
  const payload = signLoginWidget(botToken, {
    id: 777,
    first_name: 'Web',
    auth_date: Math.floor(Date.now() / 1000) - 60 * 60 - 5,
  })

  assert.throws(() => verifyTelegramLoginWidget(payload, botToken), /expired/)
})

test('web session stores hash only and resolves token', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-websess-'))
  process.env.AZAROV_STORE_DIR = dir

  try {
    const {
      createWebSession,
      resolveWebSession,
      revokeWebSession,
      parseCookieHeader,
      WEB_SESSION_COOKIE,
      serializeSetCookie,
      buildWebSessionCookieOptions,
    } = await import('./web-sessions.mjs')

    const created = createWebSession(42, { userAgent: 'test', ip: '127.0.0.1' })
    assert.ok(created.token.length >= 32)

    const resolved = resolveWebSession(created.token)
    assert.equal(resolved.telegramUserId, 42)

    assert.equal(resolveWebSession('not-a-real-token-value-xxxxxx'), null)

    const cookie = serializeSetCookie(
      WEB_SESSION_COOKIE,
      created.token,
      buildWebSessionCookieOptions(created.expiresAt),
    )
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=lax/i)
    assert.doesNotMatch(cookie, /Secure/)

    const parsed = parseCookieHeader(`${WEB_SESSION_COOKIE}=${encodeURIComponent(created.token)}`)
    assert.equal(parsed[WEB_SESSION_COOKIE], created.token)

    assert.equal(revokeWebSession(created.token), true)
    assert.equal(resolveWebSession(created.token), null)
  } finally {
    delete process.env.AZAROV_STORE_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})
