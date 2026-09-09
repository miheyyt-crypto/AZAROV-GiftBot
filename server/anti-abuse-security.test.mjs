import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  enforceAntiAbuseOnStore,
  hashIp,
  normalizeClientIp,
  peekRegistrationSignals,
  userCanUseAppEconomy,
} from './anti-abuse.mjs'
import { clientIp } from './rate-limit.mjs'
import { bootstrapUser, processReferral, registerBotStart } from './referrals.mjs'
import { createEmptyStore, withStore } from './store.mjs'
import { createUser } from './users.mjs'
import { addCoins, TX_TYPE } from './wallet.mjs'

const DEVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DEVICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

async function withTempStore(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-sec-audit-'))
  const prevDir = process.env.AZAROV_STORE_DIR
  const prevSecret = process.env.ANTI_ABUSE_HMAC_SECRET
  const prevNode = process.env.NODE_ENV
  process.env.AZAROV_STORE_DIR = dir
  process.env.ANTI_ABUSE_HMAC_SECRET = 'sec-audit-secret'
  try {
    await fn()
  } finally {
    if (prevDir === undefined) delete process.env.AZAROV_STORE_DIR
    else process.env.AZAROV_STORE_DIR = prevDir
    if (prevSecret === undefined) delete process.env.ANTI_ABUSE_HMAC_SECRET
    else process.env.ANTI_ABUSE_HMAC_SECRET = prevSecret
    if (prevNode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNode
    rmSync(dir, { recursive: true, force: true })
  }
}

test('IPv4 mapped IPv6 normalizes to same hash', () => {
  assert.equal(normalizeClientIp('::ffff:1.2.3.4'), '1.2.3.4')
  assert.equal(hashIp('1.2.3.4'), hashIp('::ffff:1.2.3.4'))
  assert.equal(normalizeClientIp('01.002.003.004'), '1.2.3.4')
})

test('IPv6 compressed and expanded share hash', () => {
  const a = normalizeClientIp('2001:db8::1')
  const b = normalizeClientIp('2001:0db8:0000:0000:0000:0000:0000:0001')
  assert.equal(a, b)
  assert.equal(hashIp('2001:db8::1'), hashIp('2001:0db8:0000:0000:0000:0000:0000:0001'))
})

test('production clientIp ignores spoofed X-Forwarded-For when req.ip set behind trusted hop', () => {
  process.env.NODE_ENV = 'production'
  const req = {
    ip: '10.20.30.40',
    headers: { 'x-forwarded-for': '9.9.9.9, 10.20.30.40' },
    socket: { remoteAddress: '10.0.0.2' },
  }
  assert.equal(clientIp(req), '10.20.30.40')
})

test('production clientIp does not trust raw XFF when req.ip missing', () => {
  process.env.NODE_ENV = 'production'
  const req = {
    ip: '',
    headers: { 'x-forwarded-for': '8.8.8.8' },
    socket: { remoteAddress: '::ffff:127.0.0.1' },
  }
  assert.equal(clientIp(req), '127.0.0.1')
})

test('production clientIp ignores Express req.ip when peer is public (direct container)', () => {
  process.env.NODE_ENV = 'production'
  const req = {
    ip: '8.8.8.8',
    headers: { 'x-forwarded-for': '8.8.8.8' },
    socket: { remoteAddress: '203.0.113.9' },
  }
  assert.equal(clientIp(req), '203.0.113.9')
})

test('registerBotStart does not create user for first-time visitor', async () => {
  await withTempStore(async () => {
    const result = registerBotStart({ id: 5001, first_name: 'New' }, 'ref_ABCDEF12')
    assert.equal(result.deferred, true)
    const exists = withStore((store) => Boolean(store.users['5001']))
    assert.equal(exists, false)
    const pending = withStore((store) => store.pendingBotStarts['5001']?.payload)
    assert.ok(pending)
  })
})

test('bootstrap without enforce does not create new telegram user', async () => {
  await withTempStore(async () => {
    const result = bootstrapUser({ id: 5002, first_name: 'X' }, '')
    assert.equal(result.created, false)
    assert.equal(result.antiAbuse.code, 'REGISTRATION_INCOMPLETE')
    const exists = withStore((store) => Boolean(store.users['5002']))
    assert.equal(exists, false)
  })
})

test('new telegram + used IP is blocked and creates blocked shell only after peek', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const a = createUser(store, { id: 5101, first_name: 'A' }, { unbound: true })
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '55.55.55.55' })
    })
    const result = bootstrapUser(
      { id: 5102, first_name: 'B' },
      '',
      { enforceAntiAbuse: true, deviceId: DEVICE_B, ip: '55.55.55.55' },
    )
    assert.equal(result.blocked, true)
    assert.equal(result.antiAbuse.code, 'MULTI_ACCOUNT_BLOCKED')
    const user = withStore((store) => store.users['5102'])
    assert.equal(user.blocked, true)
    assert.equal(userCanUseAppEconomy(user).ok, false)
  })
})

test('clear storage new device same IP still blocks', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const a = createUser(store, { id: 5201, first_name: 'A' }, { unbound: true })
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '66.66.66.66' })
    })
    const peek = withStore((store) =>
      peekRegistrationSignals(store, { deviceId: DEVICE_B, ip: '66.66.66.66' }),
    )
    assert.equal(peek.ok, false)
    assert.equal(peek.ipUsed, true)
  })
})

test('existing telegram new IP/device still allows login', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const a = createUser(store, { id: 5301, first_name: 'A' }, { unbound: true })
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '77.77.77.77' })
    })
    const result = bootstrapUser(
      { id: 5301, first_name: 'A' },
      '',
      { enforceAntiAbuse: true, deviceId: DEVICE_B, ip: '88.88.88.88' },
    )
    assert.equal(result.blocked, false)
    assert.equal(result.antiAbuse.allowed, true)
  })
})

test('blocked user cannot receive coins or referral', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const referrer = createUser(store, { id: 5401, first_name: 'R' })
      const invitee = createUser(store, { id: 5402, first_name: 'I' })
      invitee.blocked = true
      invitee.antiAbuseBound = true
      const coins = addCoins(store, invitee, 100, TX_TYPE.TASK_REWARD, 'blocked-task')
      const referral = processReferral(store, invitee, `ref_${referrer.referralCode}`)
      return { coins, referral, balance: invitee.balance }
    })
    assert.equal(out.coins.granted, false)
    assert.equal(out.referral.applied, false)
    assert.equal(out.balance, 0)
  })
})

test('unbound user cannot receive coins', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const user = createUser(store, { id: 5501, first_name: 'U' }, { unbound: true })
      const coins = addCoins(store, user, 50, TX_TYPE.TASK_REWARD, 'unbound-task')
      return { coins, gate: userCanUseAppEconomy(user) }
    })
    assert.equal(out.gate.ok, false)
    assert.equal(out.coins.granted, false)
  })
})

test('concurrent same-IP registration: only one wins', async () => {
  await withTempStore(async () => {
    const outcome = withStore((store) => {
      const first = peekRegistrationSignals(store, { deviceId: DEVICE_A, ip: '99.99.99.99' })
      assert.equal(first.ok, true)
      const a = createUser(store, { id: 5601, first_name: 'A' }, { unbound: true })
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '99.99.99.99' })
      const second = peekRegistrationSignals(store, { deviceId: DEVICE_B, ip: '99.99.99.99' })
      return second
    })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.code, 'MULTI_ACCOUNT_BLOCKED')
  })
})

test('persistence: indexes survive store reload', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const a = createUser(store, { id: 5701, first_name: 'A' }, { unbound: true })
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '12.12.12.12' })
    })
    const after = withStore((store) => ({
      device: store.deviceIndex[DEVICE_A]?.telegramId,
      ip: store.ipHashIndex[hashIp('12.12.12.12')]?.telegramId,
    }))
    assert.equal(Number(after.device), 5701)
    assert.equal(Number(after.ip), 5701)
  })
})
