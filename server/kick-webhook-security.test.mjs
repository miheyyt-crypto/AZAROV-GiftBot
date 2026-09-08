import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  isKickWebhookTimestampFresh,
  KICK_WEBHOOK_TIMESTAMP_TOLERANCE_MS,
  verifyKickWebhookSignature,
  _resetKickApiCaches,
} from './kick-api.mjs'
import { handleKickFollowWebhook } from './kick-follow.mjs'
import { withStore } from './store.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-kick-wh-'))
  const previous = process.env.AZAROV_STORE_DIR
  const prevClient = process.env.KICK_CLIENT_ID
  const prevSecret = process.env.KICK_CLIENT_SECRET
  const prevRedirect = process.env.KICK_REDIRECT_URI
  const prevChannel = process.env.KICK_REQUIRED_CHANNEL

  process.env.AZAROV_STORE_DIR = dir
  process.env.KICK_CLIENT_ID = 'test-client'
  process.env.KICK_CLIENT_SECRET = 'test-secret'
  process.env.KICK_REDIRECT_URI = 'https://example.com/api/kick/callback'
  process.env.KICK_REQUIRED_CHANNEL = 'azarov7777'
  _resetKickApiCaches()

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      if (prevClient === undefined) delete process.env.KICK_CLIENT_ID
      else process.env.KICK_CLIENT_ID = prevClient
      if (prevSecret === undefined) delete process.env.KICK_CLIENT_SECRET
      else process.env.KICK_CLIENT_SECRET = prevSecret
      if (prevRedirect === undefined) delete process.env.KICK_REDIRECT_URI
      else process.env.KICK_REDIRECT_URI = prevRedirect
      if (prevChannel === undefined) delete process.env.KICK_REQUIRED_CHANNEL
      else process.env.KICK_REQUIRED_CHANNEL = prevChannel
      _resetKickApiCaches()
      rmSync(dir, { recursive: true, force: true })
    })
}

function generateKickTestKeypair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
}

function signKickWebhook({ messageId, timestamp, rawBody, privateKeyPem }) {
  const signedPayload = `${messageId}.${timestamp}.${rawBody}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signedPayload), privateKeyPem)
  return `sha256=${signature.toString('base64')}`
}

function buildWebhookReq({ messageId, timestamp, rawBody, signature, eventType }) {
  return {
    rawBody,
    body: JSON.parse(rawBody),
    headers: {
      'kick-event-message-id': messageId,
      'kick-event-message-timestamp': timestamp,
      'kick-event-signature': signature,
      'kick-event-type': eventType,
    },
  }
}

test('isKickWebhookTimestampFresh accepts RFC3339 within ±5 minutes', () => {
  const now = Date.parse('2026-09-08T12:00:00.000Z')
  assert.equal(isKickWebhookTimestampFresh('2026-09-08T12:00:00.000Z', { nowMs: now }), true)
  assert.equal(isKickWebhookTimestampFresh('2026-09-08T11:55:01.000Z', { nowMs: now }), true)
  assert.equal(isKickWebhookTimestampFresh('2026-09-08T12:04:59.000Z', { nowMs: now }), true)
  assert.equal(KICK_WEBHOOK_TIMESTAMP_TOLERANCE_MS, 5 * 60 * 1000)
})

test('isKickWebhookTimestampFresh rejects old and far-future timestamps', () => {
  const now = Date.parse('2026-09-08T12:00:00.000Z')
  assert.equal(isKickWebhookTimestampFresh('2026-09-08T11:54:59.000Z', { nowMs: now }), false)
  assert.equal(isKickWebhookTimestampFresh('2026-09-08T12:05:01.000Z', { nowMs: now }), false)
  assert.equal(isKickWebhookTimestampFresh('not-a-date', { nowMs: now }), false)
})

test('valid fresh Kick webhook is accepted', async () => {
  await withTempStore(async () => {
    const { publicKey, privateKey } = generateKickTestKeypair()
    const nowMs = Date.parse('2026-09-08T12:00:00.000Z')
    const timestamp = new Date(nowMs).toISOString()
    const messageId = 'msg-fresh-001'
    const rawBody = JSON.stringify({
      follower: { user_id: 111 },
      broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
    })
    const signature = signKickWebhook({ messageId, timestamp, rawBody, privateKeyPem: privateKey })
    const req = buildWebhookReq({
      messageId,
      timestamp,
      rawBody,
      signature,
      eventType: 'channel.followed',
    })

    const result = await handleKickFollowWebhook(req, { publicKeyPem: publicKey, nowMs })
    assert.equal(result.ok, true)
    assert.equal(result.status, 200)
  })
})

test('old Kick webhook is rejected after signature check', async () => {
  await withTempStore(async () => {
    const { publicKey, privateKey } = generateKickTestKeypair()
    const nowMs = Date.parse('2026-09-08T12:00:00.000Z')
    const timestamp = new Date(nowMs - 10 * 60 * 1000).toISOString()
    const messageId = 'msg-old-001'
    const rawBody = JSON.stringify({
      follower: { user_id: 112 },
      broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
    })
    const signature = signKickWebhook({ messageId, timestamp, rawBody, privateKeyPem: privateKey })
    const req = buildWebhookReq({
      messageId,
      timestamp,
      rawBody,
      signature,
      eventType: 'channel.followed',
    })

    const result = await handleKickFollowWebhook(req, { publicKeyPem: publicKey, nowMs })
    assert.equal(result.ok, false)
    assert.equal(result.status, 401)
    assert.equal(result.message, 'stale_timestamp')
  })
})

test('future Kick webhook beyond skew is rejected', async () => {
  await withTempStore(async () => {
    const { publicKey, privateKey } = generateKickTestKeypair()
    const nowMs = Date.parse('2026-09-08T12:00:00.000Z')
    const timestamp = new Date(nowMs + 10 * 60 * 1000).toISOString()
    const messageId = 'msg-future-001'
    const rawBody = JSON.stringify({
      follower: { user_id: 113 },
      broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
    })
    const signature = signKickWebhook({ messageId, timestamp, rawBody, privateKeyPem: privateKey })
    const req = buildWebhookReq({
      messageId,
      timestamp,
      rawBody,
      signature,
      eventType: 'channel.followed',
    })

    const result = await handleKickFollowWebhook(req, { publicKeyPem: publicKey, nowMs })
    assert.equal(result.ok, false)
    assert.equal(result.message, 'stale_timestamp')
  })
})

test('invalid Kick webhook signature is rejected before timestamp', async () => {
  await withTempStore(async () => {
    const { publicKey } = generateKickTestKeypair()
    const nowMs = Date.parse('2026-09-08T12:00:00.000Z')
    const timestamp = new Date(nowMs).toISOString()
    const messageId = 'msg-bad-sig'
    const rawBody = JSON.stringify({
      follower: { user_id: 114 },
      broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
    })
    const req = buildWebhookReq({
      messageId,
      timestamp,
      rawBody,
      signature: 'sha256=AAAA',
      eventType: 'channel.followed',
    })

    const result = await handleKickFollowWebhook(req, { publicKeyPem: publicKey, nowMs })
    assert.equal(result.ok, false)
    assert.equal(result.message, 'invalid_signature')
    assert.equal(
      verifyKickWebhookSignature({
        messageId,
        timestamp,
        rawBody,
        signature: 'sha256=AAAA',
        publicKeyPem: publicKey,
      }),
      false,
    )
  })
})

test('duplicate fresh follow webhook does not create multiple follow records', async () => {
  await withTempStore(async () => {
    const { publicKey, privateKey } = generateKickTestKeypair()
    const nowMs = Date.parse('2026-09-08T12:00:00.000Z')
    const timestamp = new Date(nowMs).toISOString()
    const messageId = 'msg-follow-dup-001'
    const rawBody = JSON.stringify({
      follower: { user_id: 115 },
      broadcaster: { user_id: 37093990, channel_slug: 'azarov7777' },
    })
    const signature = signKickWebhook({ messageId, timestamp, rawBody, privateKeyPem: privateKey })
    const req = buildWebhookReq({
      messageId,
      timestamp,
      rawBody,
      signature,
      eventType: 'channel.followed',
    })

    const first = await handleKickFollowWebhook(req, { publicKeyPem: publicKey, nowMs })
    const second = await handleKickFollowWebhook(req, { publicKeyPem: publicKey, nowMs })

    assert.equal(first.ok, true)
    assert.equal(second.ok, true)

    withStore((store) => {
      const follows = Object.values(store.kickFollows || {}).filter(
        (row) => String(row.followerKickUserId) === '115',
      )
      assert.equal(follows.length, 1)
      return true
    })
  })
})
