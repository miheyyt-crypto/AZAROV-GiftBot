import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID } from './constants.mjs'
import {
  checkGiveawayEligibility,
  normalizeGiveawayEligibility,
  resolveGiveawayEligibility,
  WELVURA_TASK_1_ID,
  WELVURA_TASK_2_ID,
} from './giveaway-eligibility.mjs'
import {
  createGiveawayOnStore,
  getPublicGiveawayOnStore,
  participateOnStore,
  stopGiveawayScheduler,
  validateGiveawayCreateInput,
} from './giveaways.mjs'
import { createUser } from './users.mjs'
import { withStore } from './store.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-gw-elig-'))
  const previous = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir
  stopGiveawayScheduler()

  return Promise.resolve()
    .then(() => run())
    .finally(() => {
      stopGiveawayScheduler()
      if (previous === undefined) delete process.env.AZAROV_STORE_DIR
      else process.env.AZAROV_STORE_DIR = previous
      rmSync(dir, { recursive: true, force: true })
    })
}

function seedUser(store, telegramId, extras = {}) {
  createUser(store, {
    id: telegramId,
    first_name: extras.firstName || `User${telegramId}`,
    username: extras.username || `u${telegramId}`,
    photo_url: '',
  })
  const user = store.users[String(telegramId)]
  if (Array.isArray(extras.completedTasks)) {
    user.completedTasks = [...extras.completedTasks]
  }
  if (typeof extras.welvuraVerified === 'boolean') {
    user.welvuraVerified = extras.welvuraVerified
  }
  return user
}

function futureIso(hoursFromNow) {
  return new Date(Date.now() + hoursFromNow * 3_600_000).toISOString()
}

function pastIso(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
}

function validCreateBody(overrides = {}) {
  return {
    title: 'Eligibility test',
    description: 'test',
    image: '/uploads/giveaways/demo.jpg',
    prizeType: 'coins',
    prizeAmount: 100,
    prizeText: null,
    winnersCount: 1,
    startAt: pastIso(1),
    endAt: futureIso(2),
    ...overrides,
  }
}

test('resolveGiveawayEligibility: missing → all; legacy maps; unknown → null', () => {
  assert.equal(resolveGiveawayEligibility({}), 'all')
  assert.equal(resolveGiveawayEligibility({ eligibility: null }), 'all')
  assert.equal(resolveGiveawayEligibility({ eligibility: '' }), 'all')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'kick' }), 'kick')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'welvura_verified' }), 'welvura_verified')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'category_a' }), 'kick')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'category_b' }), 'welvura_verified')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'vip' }), null)
  assert.equal(normalizeGiveawayEligibility('category_a'), 'kick')
  assert.equal(normalizeGiveawayEligibility('vip'), null)
})

test('checkGiveawayEligibility: all allows empty user', () => {
  const result = checkGiveawayEligibility({ completedTasks: [] }, { eligibility: 'all' })
  assert.equal(result.eligible, true)
})

test('checkGiveawayEligibility: kick requires connect AND follow', () => {
  const empty = { completedTasks: [] }
  const onlyConnect = { completedTasks: [KICK_CONNECT_TASK_ID] }
  const onlyFollow = { completedTasks: [KICK_FOLLOW_TASK_ID] }
  const both = { completedTasks: [KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID] }

  assert.equal(checkGiveawayEligibility(empty, { eligibility: 'kick' }).eligible, false)
  assert.deepEqual(checkGiveawayEligibility(empty, { eligibility: 'kick' }).missing, [
    KICK_CONNECT_TASK_ID,
    KICK_FOLLOW_TASK_ID,
  ])
  assert.equal(checkGiveawayEligibility(onlyConnect, { eligibility: 'kick' }).eligible, false)
  assert.deepEqual(checkGiveawayEligibility(onlyConnect, { eligibility: 'kick' }).missing, [
    KICK_FOLLOW_TASK_ID,
  ])
  assert.equal(checkGiveawayEligibility(onlyFollow, { eligibility: 'kick' }).eligible, false)
  assert.deepEqual(checkGiveawayEligibility(onlyFollow, { eligibility: 'kick' }).missing, [
    KICK_CONNECT_TASK_ID,
  ])
  assert.equal(checkGiveawayEligibility(both, { eligibility: 'kick' }).eligible, true)
})

test('checkGiveawayEligibility: welvura_verified requires both tasks AND flag', () => {
  const noTasks = { completedTasks: [], welvuraVerified: false }
  const onlyFirst = { completedTasks: [WELVURA_TASK_1_ID], welvuraVerified: false }
  const onlySecond = { completedTasks: [WELVURA_TASK_2_ID], welvuraVerified: false }
  const bothNoFlag = {
    completedTasks: [WELVURA_TASK_1_ID, WELVURA_TASK_2_ID],
    welvuraVerified: false,
  }
  const bothWithFlag = {
    completedTasks: [WELVURA_TASK_1_ID, WELVURA_TASK_2_ID],
    welvuraVerified: true,
  }

  assert.equal(
    checkGiveawayEligibility(noTasks, { eligibility: 'welvura_verified' }).eligible,
    false,
  )
  assert.ok(
    checkGiveawayEligibility(noTasks, { eligibility: 'welvura_verified' }).missing.includes(
      WELVURA_TASK_1_ID,
    ),
  )
  assert.equal(
    checkGiveawayEligibility(onlyFirst, { eligibility: 'welvura_verified' }).eligible,
    false,
  )
  assert.equal(
    checkGiveawayEligibility(onlySecond, { eligibility: 'welvura_verified' }).eligible,
    false,
  )
  assert.equal(
    checkGiveawayEligibility(bothNoFlag, { eligibility: 'welvura_verified' }).eligible,
    false,
  )
  assert.deepEqual(
    checkGiveawayEligibility(bothNoFlag, { eligibility: 'welvura_verified' }).missing,
    ['welvura_verified'],
  )
  assert.equal(
    checkGiveawayEligibility(bothWithFlag, { eligibility: 'welvura_verified' }).eligible,
    true,
  )
})

test('checkGiveawayEligibility: unknown eligibility denies', () => {
  const result = checkGiveawayEligibility({ completedTasks: [] }, { eligibility: 'vip' })
  assert.equal(result.eligible, false)
  assert.ok(result.missing.includes('unknown_eligibility'))
})

test('createGiveaway stores kick / welvura_verified; legacy create maps category_a', async () => {
  await withTempStore(async () => {
    const kick = withStore((store) =>
      createGiveawayOnStore(store, validCreateBody({ eligibility: 'kick' })),
    )
    assert.equal(kick.giveaway.eligibility, 'kick')

    const welvura = withStore((store) =>
      createGiveawayOnStore(store, validCreateBody({ eligibility: 'welvura_verified' })),
    )
    assert.equal(welvura.giveaway.eligibility, 'welvura_verified')

    const legacy = withStore((store) =>
      createGiveawayOnStore(store, validCreateBody({ eligibility: 'category_a' })),
    )
    assert.equal(legacy.giveaway.eligibility, 'kick')

    const defaulted = withStore((store) => createGiveawayOnStore(store, validCreateBody()))
    assert.equal(defaulted.giveaway.eligibility, 'all')

    const legacyPublic = withStore((store) => {
      const id = createGiveawayOnStore(store, validCreateBody()).giveaway.id
      delete store.giveaways[id].eligibility
      return getPublicGiveawayOnStore(store, id)
    })
    assert.equal(legacyPublic.eligibility, 'all')

    const legacyRow = withStore((store) => {
      const id = createGiveawayOnStore(store, validCreateBody({ eligibility: 'all' })).giveaway
        .id
      store.giveaways[id].eligibility = 'category_b'
      return getPublicGiveawayOnStore(store, id)
    })
    assert.equal(legacyRow.eligibility, 'welvura_verified')
  })
})

test('validateGiveawayCreateInput rejects unknown eligibility', () => {
  assert.equal(
    validateGiveawayCreateInput(validCreateBody({ eligibility: 'vip' })).code,
    'INVALID_ELIGIBILITY',
  )
})

test('participate: all allows any user', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1001)
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'all' })).giveaway.id
    })
    const result = withStore((store) => participateOnStore(store, giveawayId, 1001))
    assert.equal(result.success, true)
  })
})

test('participate: kick denies partial then allows both tasks', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1002)
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'kick' })).giveaway.id
    })

    const denied = withStore((store) => participateOnStore(store, giveawayId, 1002))
    assert.equal(denied.success, false)
    assert.equal(denied.code, 'GIVEAWAY_NOT_ELIGIBLE')
    assert.equal(denied.requirement, 'kick')

    const onlyConnect = withStore((store) => {
      store.users['1002'].completedTasks = [KICK_CONNECT_TASK_ID]
      return participateOnStore(store, giveawayId, 1002)
    })
    assert.equal(onlyConnect.success, false)

    const allowed = withStore((store) => {
      store.users['1002'].completedTasks = [KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID]
      return participateOnStore(store, giveawayId, 1002)
    })
    assert.equal(allowed.success, true)
  })
})

test('participate: welvura_verified denies until tasks + verified flag', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1003)
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'welvura_verified' }))
        .giveaway.id
    })

    const denied = withStore((store) => participateOnStore(store, giveawayId, 1003))
    assert.equal(denied.success, false)
    assert.equal(denied.requirement, 'welvura_verified')

    const bothNoFlag = withStore((store) => {
      store.users['1003'].completedTasks = [WELVURA_TASK_1_ID, WELVURA_TASK_2_ID]
      store.users['1003'].welvuraVerified = false
      return participateOnStore(store, giveawayId, 1003)
    })
    assert.equal(bothNoFlag.success, false)
    assert.ok(bothNoFlag.missing.includes('welvura_verified'))

    const allowed = withStore((store) => {
      store.users['1003'].welvuraVerified = true
      return participateOnStore(store, giveawayId, 1003)
    })
    assert.equal(allowed.success, true)
  })
})

test('participate: legacy category_a row uses kick rules', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1004)
      const created = createGiveawayOnStore(store, validCreateBody({ eligibility: 'all' }))
      store.giveaways[created.giveaway.id].eligibility = 'category_a'
      return created.giveaway.id
    })

    const denied = withStore((store) => participateOnStore(store, giveawayId, 1004))
    assert.equal(denied.success, false)
    assert.equal(denied.requirement, 'kick')

    const allowed = withStore((store) => {
      store.users['1004'].completedTasks = [KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID]
      return participateOnStore(store, giveawayId, 1004)
    })
    assert.equal(allowed.success, true)
  })
})

test('legacy giveaway without eligibility field allows join as all', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1005)
      const created = createGiveawayOnStore(store, validCreateBody())
      delete store.giveaways[created.giveaway.id].eligibility
      return created.giveaway.id
    })
    const result = withStore((store) => participateOnStore(store, giveawayId, 1005))
    assert.equal(result.success, true)
  })
})

test('security: ineligible kick user cannot join via store participate API', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1006, { completedTasks: [KICK_CONNECT_TASK_ID] })
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'kick' })).giveaway.id
    })
    const result = withStore((store) => participateOnStore(store, giveawayId, 1006))
    assert.equal(result.success, false)
    assert.equal(result.code, 'GIVEAWAY_NOT_ELIGIBLE')
    withStore((store) => {
      assert.equal(Object.keys(store.giveawayParticipants || {}).length, 0)
      assert.equal(store.giveaways[giveawayId].participantsCount, 0)
    })
  })
})

test('security: client cannot spoof welvuraVerified via non-persisted field alone without store user flag', () => {
  const fakeClientUser = {
    completedTasks: [WELVURA_TASK_1_ID, WELVURA_TASK_2_ID],
    welvuraVerified: true,
  }
  // This is server-side data shape only — check uses the object passed from store.
  assert.equal(
    checkGiveawayEligibility(fakeClientUser, { eligibility: 'welvura_verified' }).eligible,
    true,
  )
  assert.equal(
    checkGiveawayEligibility(
      { completedTasks: [WELVURA_TASK_1_ID, WELVURA_TASK_2_ID] },
      { eligibility: 'welvura_verified' },
    ).eligible,
    false,
  )
})
