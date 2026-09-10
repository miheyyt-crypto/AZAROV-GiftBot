import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  clientIp,
  isTrustedProxyHop,
  trustProxyHop,
} from './rate-limit.mjs'
import { bootstrapUser, processReferral } from './referrals.mjs'
import {
  enforceAntiAbuseOnStore,
  peekRegistrationSignals,
} from './anti-abuse.mjs'
import { withStore } from './store.mjs'
import { createUser } from './users.mjs'
import { addCoins, TX_TYPE } from './wallet.mjs'
import {
  createWebSession,
  WEB_SESSION_COOKIE,
} from './web-sessions.mjs'
import {
  assertSingleReplicaDeployment,
  getUnsafeMultiProcessHints,
} from './deploy-safety.mjs'

// Ban system removed — env flag is ignored.
process.env.ANTI_ABUSE_MULTI_ACCOUNT = '1'

const DEVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DEVICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const BOT_TOKEN = '123456:HTTP_AUTH_SECURITY_TOKEN'

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

function initDataFor(userId, extra = {}) {
  return signInitData(BOT_TOKEN, {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({
      id: userId,
      first_name: `U${userId}`,
      username: `u${userId}`,
      ...extra,
    }),
  })
}

async function withTempHttp(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-http-auth-'))
  const prev = {
    store: process.env.AZAROV_STORE_DIR,
    bot: process.env.BOT_TOKEN,
    admin: process.env.ADMIN_API_KEY,
    hmac: process.env.ANTI_ABUSE_HMAC_SECRET,
    node: process.env.NODE_ENV,
  }
  process.env.AZAROV_STORE_DIR = dir
  process.env.BOT_TOKEN = BOT_TOKEN
  process.env.ADMIN_API_KEY = '0123456789abcdef0123456789abcdef'
  process.env.ANTI_ABUSE_HMAC_SECRET = 'http-auth-security-hmac-secret!!'
  process.env.NODE_ENV = 'test'

  try {
    const { app } = await import(`./index.mjs?http-auth=${Date.now()}`)
    const server = http.createServer(app)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`
    await run({ base, dir })
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  } finally {
    if (prev.store === undefined) delete process.env.AZAROV_STORE_DIR
    else process.env.AZAROV_STORE_DIR = prev.store
    if (prev.bot === undefined) delete process.env.BOT_TOKEN
    else process.env.BOT_TOKEN = prev.bot
    if (prev.admin === undefined) delete process.env.ADMIN_API_KEY
    else process.env.ADMIN_API_KEY = prev.admin
    if (prev.hmac === undefined) delete process.env.ANTI_ABUSE_HMAC_SECRET
    else process.env.ANTI_ABUSE_HMAC_SECRET = prev.hmac
    if (prev.node === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prev.node
    rmSync(dir, { recursive: true, force: true })
  }
}

function seedBoundUser(id) {
  return withStore((store) => {
    const user = createUser(store, { id, first_name: `U${id}`, username: `u${id}` }, { unbound: true })
    enforceAntiAbuseOnStore(store, user, {
      deviceId: id % 2 === 0 ? DEVICE_A : DEVICE_B,
      ip: `203.0.113.${(id % 200) + 1}`,
    })
    user.claimedLevelRewards = [1]
    return user
  })
}

function cookieHeader(token) {
  return `${WEB_SESSION_COOKIE}=${encodeURIComponent(token)}`
}

test('isTrustedProxyHop accepts private/CGNAT/loopback and rejects public', () => {
  assert.equal(isTrustedProxyHop('127.0.0.1'), true)
  assert.equal(isTrustedProxyHop('::1'), true)
  assert.equal(isTrustedProxyHop('10.1.2.3'), true)
  assert.equal(isTrustedProxyHop('172.16.0.1'), true)
  assert.equal(isTrustedProxyHop('192.168.1.1'), true)
  assert.equal(isTrustedProxyHop('100.64.1.2'), true)
  assert.equal(isTrustedProxyHop('8.8.8.8'), false)
  assert.equal(isTrustedProxyHop('1.2.3.4'), false)
  assert.equal(trustProxyHop('10.0.0.1'), true)
  assert.equal(trustProxyHop('9.9.9.9'), false)
})

test('production: public socket ignores spoofed Express req.ip / XFF / X-Real-IP / Forwarded', () => {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const req = {
      ip: '1.2.3.4', // would be spoofed under naive trust proxy:1
      headers: {
        'x-forwarded-for': '1.2.3.4, 5.5.5.5',
        'x-real-ip': '1.2.3.4',
        forwarded: 'for=1.2.3.4',
      },
      socket: { remoteAddress: '203.0.113.50' },
    }
    assert.equal(clientIp(req), '203.0.113.50')
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prev
  }
})

test('production: trusted private proxy peer uses Express req.ip (Railway path)', () => {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const req = {
      ip: '198.51.100.20',
      headers: { 'x-forwarded-for': '198.51.100.20, 10.0.0.5' },
      socket: { remoteAddress: '10.0.0.5' },
    }
    assert.equal(clientIp(req), '198.51.100.20')
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prev
  }
})

test('deploy-safety detects WEB_CONCURRENCY / PM2 multi-process hints', () => {
  const prevWeb = process.env.WEB_CONCURRENCY
  const prevPm2 = process.env.PM2_INSTANCES
  try {
    process.env.WEB_CONCURRENCY = '2'
    delete process.env.PM2_INSTANCES
    const hints = getUnsafeMultiProcessHints()
    assert.ok(hints.some((h) => h.includes('WEB_CONCURRENCY')))
    process.env.WEB_CONCURRENCY = '1'
    process.env.PM2_INSTANCES = '3'
    const hints2 = getUnsafeMultiProcessHints()
    assert.ok(hints2.some((h) => h.includes('PM2_INSTANCES')))
    const boot = assertSingleReplicaDeployment({ isProduction: false })
    assert.equal(boot.multiReplicaSafe, false)
  } finally {
    if (prevWeb === undefined) delete process.env.WEB_CONCURRENCY
    else process.env.WEB_CONCURRENCY = prevWeb
    if (prevPm2 === undefined) delete process.env.PM2_INSTANCES
    else process.env.PM2_INSTANCES = prevPm2
  }
})

test('HTTP: session A cannot become user B; mismatch initData blocked; spoof IDs ignored', async () => {
  await withTempHttp(async ({ base }) => {
    seedBoundUser(91001)
    seedBoundUser(91002)

    const sessionA = createWebSession(91001, { userAgent: 'sec-test', ip: '127.0.0.1' })
    const cookieA = cookieHeader(sessionA.token)

    // Session A → /api/me is user A
    const meA = await fetch(`${base}/api/me`, { headers: { Cookie: cookieA } })
    assert.equal(meA.status, 200)
    const meABody = await meA.json()
    assert.equal(meABody.user.telegramId, 91001)

    // Session A + spoof query/headers claiming B
    const spoofMe = await fetch(
      `${base}/api/me?telegramId=91002&userId=91002&tgId=91002`,
      {
        headers: {
          Cookie: cookieA,
          'X-User-ID': '91002',
          'X-Telegram-ID': '91002',
          'X-TG-ID': '91002',
        },
      },
    )
    assert.equal(spoofMe.status, 200)
    const spoofBody = await spoofMe.json()
    assert.equal(spoofBody.user.telegramId, 91001)

    // Session A + body spoof identity keys rejected (400) or still A
    const bodySpoof = await fetch(`${base}/api/auth/me`, {
      method: 'GET',
      headers: {
        Cookie: cookieA,
        'Content-Type': 'application/json',
        'X-Telegram-ID': '91002',
      },
    })
    assert.equal(bodySpoof.status, 200)
    assert.equal((await bodySpoof.json()).user.telegramId, 91001)

    // Session A + Telegram B initData → identity mismatch BLOCK
    const mismatch = await fetch(`${base}/api/me`, {
      headers: {
        Cookie: cookieA,
        Authorization: `tma ${initDataFor(91002)}`,
      },
    })
    assert.equal(mismatch.status, 401)
    const mismatchBody = await mismatch.json()
    assert.equal(mismatchBody.code, 'AUTH_IDENTITY_MISMATCH')

    // Tampered session cookie
    const tampered = await fetch(`${base}/api/me`, {
      headers: { Cookie: cookieHeader(`${sessionA.token}x`) },
    })
    assert.equal(tampered.status, 401)

    // Missing session
    const missing = await fetch(`${base}/api/me`)
    assert.equal(missing.status, 401)

    // Malformed session
    const malformed = await fetch(`${base}/api/me`, {
      headers: { Cookie: `${WEB_SESSION_COOKIE}=short` },
    })
    assert.equal(malformed.status, 401)

    // Expired session
    withStore((store) => {
      const hash = crypto.createHash('sha256').update(sessionA.token).digest('hex')
      const row = store.webSessions[hash]
      assert.ok(row)
      row.expiresAt = new Date(Date.now() - 60_000).toISOString()
    })
    const expired = await fetch(`${base}/api/me`, { headers: { Cookie: cookieA } })
    assert.equal(expired.status, 401)

    // Fresh session for economy / referral / kick / partner / community probes
    const sessionA2 = createWebSession(91001, { userAgent: 'sec-test-2', ip: '127.0.0.1' })
    const cookieA2 = cookieHeader(sessionA2.token)

    const shop = await fetch(`${base}/api/shop/purchase`, {
      method: 'POST',
      headers: {
        Cookie: cookieA2,
        'Content-Type': 'application/json',
        'X-User-ID': '91002',
      },
      body: JSON.stringify({
        productId: 'cash-5000',
        requestId: 'req-spoof-shop-01',
        telegramId: 91002,
        userId: 91002,
      }),
    })
    // Identity keys in body → 400 INVALID_PAYLOAD; never acts as B
    assert.ok([400, 403, 404].includes(shop.status))
    if (shop.status === 400) {
      const shopBody = await shop.json()
      assert.equal(shopBody.code, 'INVALID_PAYLOAD')
    }

    const referral = await fetch(`${base}/api/referrals/activate`, {
      method: 'POST',
      headers: {
        Cookie: cookieA2,
        'Content-Type': 'application/json',
        'X-Telegram-ID': '91002',
      },
      body: JSON.stringify({}),
    })
    assert.ok([200, 403].includes(referral.status))
    if (referral.status === 200) {
      const refBody = await referral.json()
      assert.equal(refBody.user.telegramId, 91001)
    }

    const kick = await fetch(`${base}/api/kick/oauth/start`, {
      method: 'POST',
      headers: {
        Cookie: cookieA2,
        'Content-Type': 'application/json',
        'X-TG-ID': '91002',
      },
      body: JSON.stringify({ telegramId: 91002 }),
    })
    assert.ok([200, 400, 403, 409, 503].includes(kick.status))
    if (kick.status === 400) {
      const kickBody = await kick.json()
      assert.equal(kickBody.code, 'INVALID_PAYLOAD')
    } else {
      const kickBody = await kick.json()
      if (kickBody.user) {
        assert.equal(kickBody.user.telegramId, 91001)
      }
    }

    const partner = await fetch(`${base}/api/partners/tasks/start`, {
      method: 'POST',
      headers: {
        Cookie: cookieA2,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskId: 'dragonmoney-task-1', userId: 91002 }),
    })
    assert.ok([200, 400, 403, 404].includes(partner.status))
    if (partner.status === 400) {
      assert.equal((await partner.json()).code, 'INVALID_PAYLOAD')
    } else if ([200, 403, 404].includes(partner.status)) {
      const pBody = await partner.json()
      if (pBody.user) assert.equal(pBody.user.telegramId, 91001)
    }

    const community = await fetch(`${base}/api/community-access/status`, {
      headers: {
        Cookie: cookieA2,
        'X-User-ID': '91002',
      },
    })
    assert.equal(community.status, 200)
    assert.equal((await community.json()).user.telegramId, 91001)

    // Valid initData A with spoofed body identity on session bootstrap
    const sessionBoot = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: {
        Authorization: `tma ${initDataFor(91001)}`,
        'Content-Type': 'application/json',
        'X-Telegram-ID': '91002',
      },
      body: JSON.stringify({
        deviceId: DEVICE_A,
        telegramId: 91002,
        userId: 91002,
        tgId: 91002,
      }),
    })
    assert.equal(sessionBoot.status, 400)
  })
})

test('HTTP: session replay from second client context still maps only to owner A', async () => {
  await withTempHttp(async ({ base }) => {
    seedBoundUser(92001)
    seedBoundUser(92002)
    const sessionA = createWebSession(92001, { userAgent: 'client-1', ip: '127.0.0.1' })
    const cookie = cookieHeader(sessionA.token)

    const a = await fetch(`${base}/api/me`, {
      headers: { Cookie: cookie, 'User-Agent': 'client-2-stolen-cookie' },
    })
    assert.equal(a.status, 200)
    assert.equal((await a.json()).user.telegramId, 92001)

    // Stolen cookie cannot escalate to B via headers
    const escalate = await fetch(`${base}/api/me?userId=92002`, {
      headers: {
        Cookie: cookie,
        'User-Agent': 'client-2-stolen-cookie',
        'X-User-ID': '92002',
      },
    })
    assert.equal(escalate.status, 200)
    assert.equal((await escalate.json()).user.telegramId, 92001)
  })
})

test('HTTP: multipart partner upload ignores spoofed telegramId fields', async () => {
  await withTempHttp(async ({ base }) => {
    seedBoundUser(93001)
    seedBoundUser(93002)
    const sessionA = createWebSession(93001, { userAgent: 'multipart', ip: '127.0.0.1' })

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W5a0AAAAASUVORK5CYII=',
      'base64',
    )
    const form = new FormData()
    form.set('taskId', 'dragonmoney-task-1')
    form.set('partnerAccountId', '123456')
    form.set('requestId', 'req-multipart-spoof-01')
    form.set('telegramId', '93002')
    form.set('userId', '93002')
    form.set('tgId', '93002')
    form.set('screenshot', new Blob([png], { type: 'image/png' }), 'shot.png')

    const res = await fetch(`${base}/api/partners/submissions`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader(sessionA.token),
        'X-Telegram-ID': '93002',
      },
      body: form,
    })
    // Forbidden identity keys in multipart fields → 400, or success attributed to A only
    assert.ok([200, 400, 403].includes(res.status))
    const body = await res.json()
    if (res.status === 400) {
      assert.equal(body.code, 'INVALID_PAYLOAD')
    } else if (body.user) {
      assert.equal(body.user.telegramId, 93001)
    }
    if (body.submission) {
      assert.equal(Number(body.submission.telegramUserId || body.submission.telegramId), 93001)
    }
  })
})

test('concurrent same-IP registration: both ALLOW (ban system removed)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-conc-'))
  const prevDir = process.env.AZAROV_STORE_DIR
  const prevHmac = process.env.ANTI_ABUSE_HMAC_SECRET
  process.env.AZAROV_STORE_DIR = dir
  process.env.ANTI_ABUSE_HMAC_SECRET = 'concurrency-hmac-secret-32chars!!'
  try {
    const ip = '198.51.100.77'
    const results = await Promise.all([
      Promise.resolve().then(() =>
        bootstrapUser(
          { id: 94001, first_name: 'A' },
          '',
          { enforceAntiAbuse: true, deviceId: DEVICE_A, ip },
        ),
      ),
      Promise.resolve().then(() =>
        bootstrapUser(
          { id: 94002, first_name: 'B' },
          '',
          { enforceAntiAbuse: true, deviceId: DEVICE_B, ip },
        ),
      ),
    ])

    const allowed = results.filter((r) => r.antiAbuse?.allowed && !r.blocked)
    assert.equal(allowed.length, 2)

    // Duplicate simultaneous registration for same TG does not fork users
    await Promise.all([
      Promise.resolve().then(() =>
        bootstrapUser(
          { id: 94001, first_name: 'A' },
          '',
          { enforceAntiAbuse: true, deviceId: DEVICE_A, ip: '198.51.100.78' },
        ),
      ),
      Promise.resolve().then(() =>
        bootstrapUser(
          { id: 94001, first_name: 'A' },
          '',
          { enforceAntiAbuse: true, deviceId: DEVICE_A, ip: '198.51.100.79' },
        ),
      ),
    ])
    const userCount = withStore((store) => Object.keys(store.users).filter((k) => k === '94001').length)
    assert.equal(userCount, 1)

    // Concurrent identical rewards → one grant
    const rewardSync = withStore((store) => {
      const user = store.users['94001']
      const a = addCoins(store, user, 25, TX_TYPE.TASK_REWARD, 'conc-reward-2')
      const b = addCoins(store, user, 25, TX_TYPE.TASK_REWARD, 'conc-reward-2')
      return { a, b }
    })
    assert.equal(Number(rewardSync.a.granted) + Number(rewardSync.b.granted), 1)

    // Concurrent referral bind → at most one applied
    const refOut = withStore((store) => {
      const referrer = createUser(store, { id: 94010, first_name: 'R' })
      const invitee = createUser(store, { id: 94011, first_name: 'I' })
      const code = `ref_${referrer.referralCode}`
      const first = processReferral(store, invitee, code)
      const second = processReferral(store, invitee, code)
      return { first, second }
    })
    assert.equal(refOut.second.applied, false)
    assert.ok(refOut.first.applied === true || Boolean(refOut.first.reason))

    const peek = peekRegistrationSignals()
    assert.equal(peek.ok, true)
  } finally {
    if (prevDir === undefined) delete process.env.AZAROV_STORE_DIR
    else process.env.AZAROV_STORE_DIR = prevDir
    if (prevHmac === undefined) delete process.env.ANTI_ABUSE_HMAC_SECRET
    else process.env.ANTI_ABUSE_HMAC_SECRET = prevHmac
    rmSync(dir, { recursive: true, force: true })
  }
})
