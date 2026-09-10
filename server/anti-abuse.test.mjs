import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  enforceAntiAbuseOnStore,
  hashIp,
  maskIp,
  parseDeviceId,
  userCanEarnRewards,
} from './anti-abuse.mjs'
import { createEmptyStore, withStore } from './store.mjs'
import { createUser, ensureUser } from './users.mjs'
import { addCoins, TX_TYPE } from './wallet.mjs'
import { applyReferralAndReward } from './referrals.mjs'

const DEVICE_A = '11111111-1111-4111-8111-111111111111'
const DEVICE_B = '22222222-2222-4222-8222-222222222222'

// Tests exercise twin blocking — keep enabled regardless of production default.
process.env.ANTI_ABUSE_MULTI_ACCOUNT = '1'

function newUnbound(store, id, name = 'U') {
  return createUser(store, { id, first_name: name }, { unbound: true })
}

async function withTempStore(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-anti-abuse-'))
  const prev = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir
  process.env.ANTI_ABUSE_HMAC_SECRET = 'test-anti-abuse-secret'
  try {
    await fn()
  } finally {
    if (prev === undefined) {
      delete process.env.AZAROV_STORE_DIR
    } else {
      process.env.AZAROV_STORE_DIR = prev
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

test('parseDeviceId accepts UUID and rejects junk', () => {
  assert.equal(parseDeviceId(DEVICE_A), DEVICE_A)
  assert.equal(parseDeviceId('not-a-uuid'), null)
})

test('hashIp is stable and maskIp hides middle octets', () => {
  const a = hashIp('185.10.20.42')
  const b = hashIp('185.10.20.42')
  const c = hashIp('185.10.20.43')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.equal(maskIp('185.10.20.42'), '185.***.***.42')
})

test('TEST 1: new telegram + new device + new IP → CREATE', async () => {
  await withTempStore(async () => {
    const result = withStore((store) => {
      const user = newUnbound(store, 1001, 'A')
      const gate = enforceAntiAbuseOnStore(store, user, {
        deviceId: DEVICE_A,
        ip: '1.1.1.1',
      })
      return { gate, user, device: store.deviceIndex[DEVICE_A], ip: store.ipHashIndex[hashIp('1.1.1.1')] }
    })
    assert.equal(result.gate.allowed, true)
    assert.equal(result.user.antiAbuseBound, true)
    assert.equal(result.user.blocked, false)
    assert.equal(Number(result.device.telegramId), 1001)
    assert.equal(Number(result.ip.telegramId), 1001)
  })
})

test('TEST 2: existing telegram same device/IP → LOGIN', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const user = newUnbound(store, 1002, 'A')
      enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '2.2.2.2' })
    })
    const again = withStore((store) => {
      const user = ensureUser(store, { id: 1002, first_name: 'A' })
      return enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '2.2.2.2' })
    })
    assert.equal(again.allowed, true)
  })
})

test('TEST 3: new telegram same device new IP → BLOCK', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const user = newUnbound(store, 1101, 'A')
      enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '3.3.3.3' })
    })
    const blocked = withStore((store) => {
      const user = newUnbound(store, 1102, 'B')
      return {
        gate: enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '4.4.4.4' }),
        user,
      }
    })
    assert.equal(blocked.gate.allowed, false)
    assert.equal(blocked.gate.code, 'MULTI_ACCOUNT_BLOCKED')
    assert.equal(blocked.user.blocked, true)
    assert.equal(blocked.user.blockReason, 'MULTI_ACCOUNT')
  })
})

test('TEST 4: new telegram new device same IP → BLOCK', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const user = newUnbound(store, 1201, 'A')
      enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '5.5.5.5' })
    })
    const blocked = withStore((store) => {
      const user = newUnbound(store, 1202, 'B')
      return enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_B, ip: '5.5.5.5' })
    })
    assert.equal(blocked.allowed, false)
    assert.equal(blocked.code, 'MULTI_ACCOUNT_BLOCKED')
  })
})

test('TEST 5: new telegram same device same IP → BLOCK', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const user = newUnbound(store, 1301, 'A')
      enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '6.6.6.6' })
    })
    const blocked = withStore((store) => {
      const user = newUnbound(store, 1302, 'B')
      return enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '6.6.6.6' })
    })
    assert.equal(blocked.allowed, false)
  })
})

test('TEST 6/7: existing telegram new device/IP/VPN → LOGIN', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const user = newUnbound(store, 1401, 'A')
      enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '7.7.7.7' })
    })
    const login = withStore((store) => {
      const user = ensureUser(store, { id: 1401, first_name: 'A' })
      return enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_B, ip: '8.8.8.8' })
    })
    assert.equal(login.allowed, true)
  })
})

test('TEST 8/9: delete localStorage (new device) same IP → BLOCK', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const user = newUnbound(store, 1501, 'A')
      enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '9.9.9.9' })
    })
    const blocked = withStore((store) => {
      const user = newUnbound(store, 1502, 'B')
      return enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_B, ip: '9.9.9.9' })
    })
    assert.equal(blocked.allowed, false)
  })
})

test('TEST 10: same device new IP → BLOCK', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const user = newUnbound(store, 1601, 'A')
      enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '10.0.0.1' })
    })
    const blocked = withStore((store) => {
      const user = newUnbound(store, 1602, 'B')
      return enforceAntiAbuseOnStore(store, user, { deviceId: DEVICE_A, ip: '10.0.0.2' })
    })
    assert.equal(blocked.allowed, false)
  })
})

test('TEST 11: concurrent same IP/device — only one association owner', async () => {
  await withTempStore(async () => {
    const outcome = withStore((store) => {
      const a = newUnbound(store, 1701, 'A')
      const b = newUnbound(store, 1702, 'B')
      const first = enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '11.11.11.11' })
      const second = enforceAntiAbuseOnStore(store, b, { deviceId: DEVICE_A, ip: '11.11.11.11' })
      return { first, second, b }
    })
    assert.equal(outcome.first.allowed, true)
    assert.equal(outcome.second.allowed, false)
    assert.equal(outcome.b.blocked, true)
  })
})

test('TEST 12: blocked user reward denied', async () => {
  await withTempStore(async () => {
    const result = withStore((store) => {
      const user = createUser(store, { id: 1801, first_name: 'A' })
      user.antiAbuseBound = true
      user.blocked = true
      user.blockReason = 'MULTI_ACCOUNT'
      const coins = addCoins(store, user, 100, TX_TYPE.TASK_REWARD, 'evt-blocked-1')
      return { coins, gate: userCanEarnRewards(user), balance: user.balance }
    })
    assert.equal(result.gate.ok, false)
    assert.equal(result.coins.granted, false)
    assert.equal(result.coins.reason, 'blocked')
    assert.equal(result.balance, 0)
  })
})

test('TEST 13: blocked user referral denied', async () => {
  await withTempStore(async () => {
    const result = withStore((store) => {
      const referrer = createUser(store, { id: 1901, first_name: 'Ref' })
      referrer.antiAbuseBound = true
      const invitee = createUser(store, { id: 1902, first_name: 'Inv' })
      invitee.blocked = true
      invitee.antiAbuseBound = true
      return applyReferralAndReward(store, invitee, `ref_${referrer.referralCode}`)
    })
    assert.equal(result.referral.applied, false)
    assert.equal(result.referral.reason, 'blocked')
  })
})

test('migration v15→v16 grandfathers existing users without auto-block', async () => {
  await withTempStore(async () => {
    const storePath = path.join(process.env.AZAROV_STORE_DIR, 'store.json')
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 14,
        users: {
          1: { telegramId: 1, balance: 10, referralCode: 'AAAA1111' },
          2: { telegramId: 2, balance: 20, referralCode: 'BBBB2222' },
        },
      }),
    )

    const snapshot = withStore((store) => ({
      version: store.version,
      u1: store.users['1'],
      u2: store.users['2'],
      deviceIndex: store.deviceIndex,
      ipHashIndex: store.ipHashIndex,
    }))

    assert.equal(snapshot.version, 18)
    assert.equal(snapshot.u1.antiAbuseBound, true)
    assert.equal(snapshot.u2.antiAbuseBound, true)
    assert.equal(snapshot.u1.antiAbuseLegacy, true)
    assert.equal(snapshot.u2.antiAbuseLegacy, true)
    assert.equal(snapshot.u1.blocked, false)
    assert.ok(snapshot.deviceIndex)
    assert.ok(snapshot.ipHashIndex)
  })
})

test('createEmptyStore is v16 with anti-abuse maps', () => {
  const store = createEmptyStore()
  assert.equal(store.version, 18)
  assert.deepEqual(store.deviceIndex, {})
  assert.deepEqual(store.ipHashIndex, {})
})
