import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  enforceAntiAbuseOnStore,
  hashIp,
  peekRegistrationSignals,
  userCanUseAppEconomy,
} from './anti-abuse.mjs'
import {
  createCommunityAccessRequestOnStore,
  syncWelvuraVerifiedFromCommunityAccess,
} from './community-access.mjs'
import { linkKickAccountOnStore } from './kick-oauth.mjs'
import {
  approvePartnerSubmissionOnStore,
  createPartnerSubmissionOnStore,
} from './partner-submissions.mjs'
import { clientIp } from './rate-limit.mjs'
import { bootstrapUser, processReferral } from './referrals.mjs'
import { createEmptyStore, withStore } from './store.mjs'
import { createUser } from './users.mjs'
import { addCoins, TX_TYPE } from './wallet.mjs'

const DEVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DEVICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DEVICE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

async function withTempStore(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-adversarial-'))
  const prevDir = process.env.AZAROV_STORE_DIR
  const prevSecret = process.env.ANTI_ABUSE_HMAC_SECRET
  const prevNode = process.env.NODE_ENV
  process.env.AZAROV_STORE_DIR = dir
  process.env.ANTI_ABUSE_HMAC_SECRET = 'adversarial-hmac-secret-32chars!!'
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

test('ADV-1 new TG + used IP → BLOCK', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const a = createUser(store, { id: 6101, first_name: 'A' }, { unbound: true })
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '101.1.1.1' })
    })
    const result = bootstrapUser(
      { id: 6102, first_name: 'B' },
      '',
      { enforceAntiAbuse: true, deviceId: DEVICE_B, ip: '101.1.1.1' },
    )
    assert.equal(result.blocked, true)
    assert.equal(result.antiAbuse.code, 'MULTI_ACCOUNT_BLOCKED')
  })
})

test('ADV-2 new TG + new IP → ALLOW', async () => {
  await withTempStore(async () => {
    const result = bootstrapUser(
      { id: 6201, first_name: 'N' },
      '',
      { enforceAntiAbuse: true, deviceId: DEVICE_A, ip: '102.2.2.2' },
    )
    assert.equal(result.blocked, false)
    assert.equal(result.antiAbuse.allowed, true)
    const user = withStore((store) => store.users['6201'])
    assert.ok(user)
    assert.equal(userCanUseAppEconomy(user).ok, true)
  })
})

test('ADV-3 existing TG + new IP → ALLOW', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const a = createUser(store, { id: 6301, first_name: 'A' }, { unbound: true })
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '103.3.3.3' })
    })
    const result = bootstrapUser(
      { id: 6301, first_name: 'A' },
      '',
      { enforceAntiAbuse: true, deviceId: DEVICE_B, ip: '103.9.9.9' },
    )
    assert.equal(result.blocked, false)
    assert.equal(result.antiAbuse.allowed, true)
  })
})

test('ADV-4 existing TG + VPN/new device → ALLOW', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const a = createUser(store, { id: 6401, first_name: 'A' }, { unbound: true })
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '104.4.4.4' })
    })
    const result = bootstrapUser(
      { id: 6401, first_name: 'A' },
      '',
      { enforceAntiAbuse: true, deviceId: DEVICE_C, ip: '185.199.108.153' },
    )
    assert.equal(result.antiAbuse.allowed, true)
  })
})

test('ADV-5 localStorage reset new device same IP → BLOCK', async () => {
  await withTempStore(async () => {
    withStore((store) => {
      const a = createUser(store, { id: 6501, first_name: 'A' }, { unbound: true })
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '105.5.5.5' })
    })
    const peek = withStore((store) =>
      peekRegistrationSignals(store, { deviceId: DEVICE_B, ip: '105.5.5.5' }),
    )
    assert.equal(peek.ok, false)
    assert.equal(peek.ipUsed, true)
  })
})

test('ADV-6 spoofed XFF cannot bypass production clientIp', () => {
  process.env.NODE_ENV = 'production'
  const req = {
    ip: '10.0.0.8',
    headers: {
      'x-forwarded-for': '1.2.3.4, 10.0.0.8',
      'x-real-ip': '1.2.3.4',
      'cf-connecting-ip': '1.2.3.4',
      'true-client-ip': '1.2.3.4',
    },
    socket: { remoteAddress: '10.0.0.1' },
  }
  assert.equal(clientIp(req), '10.0.0.8')

  const direct = {
    ip: '1.2.3.4',
    headers: { 'x-forwarded-for': '1.2.3.4' },
    socket: { remoteAddress: '198.51.100.7' },
  }
  assert.equal(clientIp(direct), '198.51.100.7')
})

test('ADV-7 unbound → no economy', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const user = createUser(store, { id: 6701, first_name: 'U' }, { unbound: true })
      return {
        gate: userCanUseAppEconomy(user),
        coins: addCoins(store, user, 10, TX_TYPE.TASK_REWARD, 'adv-unbound'),
      }
    })
    assert.equal(out.gate.ok, false)
    assert.equal(out.coins.granted, false)
  })
})

test('ADV-8 blocked → no economy', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const user = createUser(store, { id: 6801, first_name: 'B' })
      user.blocked = true
      return {
        gate: userCanUseAppEconomy(user),
        coins: addCoins(store, user, 10, TX_TYPE.TASK_REWARD, 'adv-blocked'),
      }
    })
    assert.equal(out.gate.ok, false)
    assert.equal(out.coins.granted, false)
  })
})

test('ADV-9 referral → no reward before economy gate', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const referrer = createUser(store, { id: 6901, first_name: 'R' })
      const invitee = createUser(store, { id: 6902, first_name: 'I' }, { unbound: true })
      return processReferral(store, invitee, `ref_${referrer.referralCode}`)
    })
    assert.equal(out.applied, false)
  })
})

test('ADV-10 Kick link → no reward before gate', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const user = createUser(store, { id: 7001, first_name: 'K' }, { unbound: true })
      return linkKickAccountOnStore(store, user.telegramId, {
        kickUserId: 'kick-7001',
        username: 'k7001',
        displayName: 'K',
        avatarUrl: null,
      })
    })
    assert.equal(out.ok, false)
    assert.ok(['REGISTRATION_INCOMPLETE', 'FORBIDDEN', 'MULTI_ACCOUNT_BLOCKED'].includes(out.code))
  })
})

test('ADV-11 partner create → blocked/unbound rejected', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      createUser(store, { id: 7101, first_name: 'P' }, { unbound: true })
      return createPartnerSubmissionOnStore(
        store,
        7101,
        { taskId: 'anything', partnerAccountId: '1', requestId: 'req-adv-11' },
        { buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 },
      )
    })
    assert.equal(out.success, false)
    assert.equal(out.code, 'REGISTRATION_INCOMPLETE')
  })
})

test('ADV-12 community create/approve → blocked rejected', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const user = createUser(store, { id: 7201, first_name: 'C' })
      user.blocked = true
      const created = createCommunityAccessRequestOnStore(
        store,
        { id: 7201, username: 'c7201', first_name: 'C' },
        { welvuraId: '12345', username: 'c7201', requestId: 'req-adv-12' },
        { buffer: Buffer.from('png'), mimetype: 'image/png', size: 3 },
      )
      return created
    })
    assert.equal(out.success, false)
    assert.equal(out.code, 'MULTI_ACCOUNT_BLOCKED')
  })
})

test('ADV-13 duplicate referral → one reward', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const referrer = createUser(store, { id: 7301, first_name: 'R' })
      const invitee = createUser(store, { id: 7302, first_name: 'I' })
      const first = processReferral(store, invitee, `ref_${referrer.referralCode}`)
      const second = processReferral(store, invitee, `ref_${referrer.referralCode}`)
      return { first, second, balance: invitee.balance }
    })
    // May require Kick for full reward in this project — assert no double apply.
    assert.equal(out.second.applied, false)
  })
})

test('ADV-14 grandfather reclaim: legacy login retro-blocks slipped multi-account', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const legacy = createUser(store, { id: 7401, first_name: 'Legacy' })
      legacy.antiAbuseLegacy = true
      legacy.antiAbuseBound = true
      legacy.createdAt = '2024-01-01T00:00:00.000Z'
      legacy.primaryDeviceId = null
      legacy.primaryIpHash = null

      const slipped = createUser(store, { id: 7402, first_name: 'Slipped' }, { unbound: true })
      slipped.antiAbuseLegacy = false
      slipped.createdAt = '2026-01-01T00:00:00.000Z'
      enforceAntiAbuseOnStore(store, slipped, { deviceId: DEVICE_A, ip: '114.14.14.14' })
      assert.equal(slipped.blocked, false)
      assert.equal(slipped.antiAbuseBound, true)

      const gate = enforceAntiAbuseOnStore(store, legacy, {
        deviceId: DEVICE_B,
        ip: '114.14.14.14',
      })
      return {
        gate,
        slippedBlocked: store.users['7402'].blocked,
        ipOwner: store.ipHashIndex[hashIp('114.14.14.14')]?.telegramId,
      }
    })
    assert.equal(out.gate.allowed, true)
    assert.equal(out.slippedBlocked, true)
    assert.equal(Number(out.ipOwner), 7401)
  })
})

test('ADV-15 two legacy users sharing IP → neither retro-blocked', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const a = createUser(store, { id: 7501, first_name: 'A' })
      a.antiAbuseLegacy = true
      a.antiAbuseBound = true
      a.createdAt = '2024-01-01T00:00:00.000Z'
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '115.15.15.15' })

      const b = createUser(store, { id: 7502, first_name: 'B' })
      b.antiAbuseLegacy = true
      b.antiAbuseBound = true
      b.createdAt = '2023-01-01T00:00:00.000Z'
      const gate = enforceAntiAbuseOnStore(store, b, { deviceId: DEVICE_B, ip: '115.15.15.15' })
      return {
        gate,
        aBlocked: store.users['7501'].blocked,
        bBlocked: store.users['7502'].blocked,
      }
    })
    assert.equal(out.gate.allowed, true)
    assert.equal(out.aBlocked, false)
    assert.equal(out.bBlocked, false)
  })
})

test('ADV-16 concurrent registration same IP → second blocked', async () => {
  await withTempStore(async () => {
    const outcome = withStore((store) => {
      const firstPeek = peekRegistrationSignals(store, {
        deviceId: DEVICE_A,
        ip: '116.16.16.16',
      })
      assert.equal(firstPeek.ok, true)
      const a = createUser(store, { id: 7601, first_name: 'A' }, { unbound: true })
      enforceAntiAbuseOnStore(store, a, { deviceId: DEVICE_A, ip: '116.16.16.16' })
      const b = createUser(store, { id: 7602, first_name: 'B' }, { unbound: true })
      return enforceAntiAbuseOnStore(store, b, { deviceId: DEVICE_B, ip: '116.16.16.16' })
    })
    assert.equal(outcome.allowed, false)
    assert.equal(outcome.code, 'MULTI_ACCOUNT_BLOCKED')
  })
})

test('ADV-17 concurrent reward → no double grant', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const user = createUser(store, { id: 7701, first_name: 'R' })
      const a = addCoins(store, user, 100, TX_TYPE.TASK_REWARD, 'adv-dup-reward')
      const b = addCoins(store, user, 100, TX_TYPE.TASK_REWARD, 'adv-dup-reward')
      return { a, b, balance: user.balance }
    })
    assert.equal(out.a.granted, true)
    assert.equal(out.b.granted, false)
    assert.equal(out.balance, 100)
  })
})

test('ADV-18 deviceId type confusion / empty → registration fails closed', async () => {
  await withTempStore(async () => {
    const cases = [null, undefined, '', '   ', {}, [], 123, 'NOT-UUID']
    for (const deviceId of cases) {
      const peek = withStore((store) =>
        peekRegistrationSignals(store, { deviceId, ip: '118.18.18.18' }),
      )
      assert.equal(peek.ok, false, `deviceId=${JSON.stringify(deviceId)}`)
    }
  })
})

test('ADV-19 blocked community sync cannot set welvuraVerified', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const user = createUser(store, { id: 7901, first_name: 'W' })
      user.blocked = true
      store.communityAccessRequests = {
        'req-1': {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          telegramId: 7901,
          status: 'approved',
          createdAt: new Date().toISOString(),
        },
      }
      syncWelvuraVerifiedFromCommunityAccess(store, user)
      return user.welvuraVerified
    })
    assert.equal(out, false)
  })
})

test('ADV-20 partner approve blocked user → no coins', async () => {
  await withTempStore(async () => {
    const out = withStore((store) => {
      const user = createUser(store, { id: 8001, first_name: 'P' })
      user.blocked = true
      store.partnerSubmissions = {
        'sub-adv-20': {
          submissionId: 'sub-adv-20',
          telegramUserId: 8001,
          taskId: 'dragonmoney-task-1',
          partnerId: 'dragonmoney',
          partnerAccountId: '999001',
          status: 'pending',
          reward: 0,
          createdAt: new Date().toISOString(),
        },
      }
      const approved = approvePartnerSubmissionOnStore(store, 'sub-adv-20', 'admin')
      return { approved, balance: user.balance }
    })
    assert.equal(out.approved.success, false)
    assert.equal(out.balance, 0)
  })
})

test('ADV-21 production HMAC secret required (hashIp throws without secret)', () => {
  const prevNode = process.env.NODE_ENV
  const prevSecret = process.env.ANTI_ABUSE_HMAC_SECRET
  const prevBot = process.env.BOT_TOKEN
  try {
    process.env.NODE_ENV = 'production'
    delete process.env.ANTI_ABUSE_HMAC_SECRET
    delete process.env.BOT_TOKEN
    assert.throws(() => hashIp('1.1.1.1'), /ANTI_ABUSE_HMAC_SECRET_required/)
  } finally {
    if (prevNode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNode
    if (prevSecret === undefined) delete process.env.ANTI_ABUSE_HMAC_SECRET
    else process.env.ANTI_ABUSE_HMAC_SECRET = prevSecret
    if (prevBot === undefined) delete process.env.BOT_TOKEN
    else process.env.BOT_TOKEN = prevBot
  }
})

test('ADV-22 bootstrap without enforce still cannot mint economy user', async () => {
  await withTempStore(async () => {
    const result = bootstrapUser({ id: 8201, first_name: 'X' }, '')
    assert.equal(result.created, false)
    const exists = withStore((store) => Boolean(store.users['8201']))
    assert.equal(exists, false)
  })
})
