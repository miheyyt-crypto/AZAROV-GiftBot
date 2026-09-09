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
  assert.equal(resolveGiveawayEligibility({ eligibility: 'referral' }), 'referral')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'depositor' }), 'depositor')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'category_a' }), 'all')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'kick' }), 'all')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'category_b' }), 'depositor')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'welvura_verified' }), 'depositor')
  assert.equal(resolveGiveawayEligibility({ eligibility: 'vip' }), null)
  assert.equal(normalizeGiveawayEligibility('referral'), 'referral')
  assert.equal(normalizeGiveawayEligibility('kick'), null)
  assert.equal(normalizeGiveawayEligibility('category_a'), null)
  assert.equal(normalizeGiveawayEligibility(''), 'all')
})

test('checkGiveawayEligibility: all ignores Kick and tasks', () => {
  assert.equal(checkGiveawayEligibility({ completedTasks: [] }, { eligibility: 'all' }).eligible, true)
  assert.equal(
    checkGiveawayEligibility(
      { completedTasks: [KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID] },
      { eligibility: 'all' },
    ).eligible,
    true,
  )
  assert.equal(
    checkGiveawayEligibility({ completedTasks: [WELVURA_TASK_1_ID] }, { eligibility: 'all' })
      .eligible,
    true,
  )
})

test('checkGiveawayEligibility: referral requires dragonmoney-task-1 only', () => {
  const empty = { completedTasks: [] }
  const kickOnly = { completedTasks: [KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID] }
  const task1 = { completedTasks: [WELVURA_TASK_1_ID] }
  const task2Only = { completedTasks: [WELVURA_TASK_2_ID] }

  assert.equal(checkGiveawayEligibility(empty, { eligibility: 'referral' }).eligible, false)
  assert.deepEqual(checkGiveawayEligibility(empty, { eligibility: 'referral' }).missing, [
    WELVURA_TASK_1_ID,
  ])
  assert.equal(checkGiveawayEligibility(kickOnly, { eligibility: 'referral' }).eligible, false)
  assert.equal(checkGiveawayEligibility(task1, { eligibility: 'referral' }).eligible, true)
  // task-2 alone does not satisfy referral
  assert.equal(checkGiveawayEligibility(task2Only, { eligibility: 'referral' }).eligible, false)
})

test('checkGiveawayEligibility: depositor requires dragonmoney-task-2 only', () => {
  const empty = { completedTasks: [] }
  const task1 = { completedTasks: [WELVURA_TASK_1_ID] }
  const task2 = { completedTasks: [WELVURA_TASK_2_ID] }
  const both = { completedTasks: [WELVURA_TASK_1_ID, WELVURA_TASK_2_ID] }

  assert.equal(checkGiveawayEligibility(empty, { eligibility: 'depositor' }).eligible, false)
  assert.deepEqual(checkGiveawayEligibility(empty, { eligibility: 'depositor' }).missing, [
    WELVURA_TASK_2_ID,
  ])
  assert.equal(checkGiveawayEligibility(task1, { eligibility: 'depositor' }).eligible, false)
  assert.equal(checkGiveawayEligibility(task2, { eligibility: 'depositor' }).eligible, true)
  assert.equal(checkGiveawayEligibility(both, { eligibility: 'depositor' }).eligible, true)
})

test('checkGiveawayEligibility: unknown eligibility denies', () => {
  const result = checkGiveawayEligibility({ completedTasks: [] }, { eligibility: 'vip' })
  assert.equal(result.eligible, false)
  assert.ok(result.missing.includes('unknown_eligibility'))
})

test('createGiveaway stores referral/depositor; rejects kick; maps nothing legacy on write', async () => {
  await withTempStore(async () => {
    const referral = withStore((store) =>
      createGiveawayOnStore(store, validCreateBody({ eligibility: 'referral' })),
    )
    assert.equal(referral.giveaway.eligibility, 'referral')

    const depositor = withStore((store) =>
      createGiveawayOnStore(store, validCreateBody({ eligibility: 'depositor' })),
    )
    assert.equal(depositor.giveaway.eligibility, 'depositor')

    const defaulted = withStore((store) => createGiveawayOnStore(store, validCreateBody()))
    assert.equal(defaulted.giveaway.eligibility, 'all')

    assert.equal(
      validateGiveawayCreateInput(validCreateBody({ eligibility: 'kick' })).code,
      'INVALID_ELIGIBILITY',
    )
    assert.equal(
      validateGiveawayCreateInput(validCreateBody({ eligibility: 'welvura_verified' })).code,
      'INVALID_ELIGIBILITY',
    )
    assert.equal(
      validateGiveawayCreateInput(validCreateBody({ eligibility: 'category_a' })).code,
      'INVALID_ELIGIBILITY',
    )

    const legacyPublic = withStore((store) => {
      const id = createGiveawayOnStore(store, validCreateBody()).giveaway.id
      delete store.giveaways[id].eligibility
      return getPublicGiveawayOnStore(store, id)
    })
    assert.equal(legacyPublic.eligibility, 'all')

    const oldKickRow = withStore((store) => {
      const id = createGiveawayOnStore(store, validCreateBody({ eligibility: 'all' })).giveaway.id
      store.giveaways[id].eligibility = 'kick'
      return getPublicGiveawayOnStore(store, id)
    })
    assert.equal(oldKickRow.eligibility, 'all')

    const oldWelvuraRow = withStore((store) => {
      const id = createGiveawayOnStore(store, validCreateBody({ eligibility: 'all' })).giveaway.id
      store.giveaways[id].eligibility = 'welvura_verified'
      return getPublicGiveawayOnStore(store, id)
    })
    assert.equal(oldWelvuraRow.eligibility, 'depositor')
  })
})

test('participate: all allows users with and without Kick tasks', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1001)
      seedUser(store, 1002, {
        completedTasks: [KICK_CONNECT_TASK_ID, KICK_FOLLOW_TASK_ID],
      })
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'all' })).giveaway.id
    })
    assert.equal(withStore((store) => participateOnStore(store, giveawayId, 1001)).success, true)
    assert.equal(withStore((store) => participateOnStore(store, giveawayId, 1002)).success, true)
  })
})

test('participate: referral denies then allows after task-1', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1010)
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'referral' })).giveaway
        .id
    })

    const denied = withStore((store) => participateOnStore(store, giveawayId, 1010))
    assert.equal(denied.success, false)
    assert.equal(denied.code, 'GIVEAWAY_NOT_ELIGIBLE')
    assert.equal(denied.requirement, 'referral')

    const allowed = withStore((store) => {
      store.users['1010'].completedTasks = [WELVURA_TASK_1_ID]
      return participateOnStore(store, giveawayId, 1010)
    })
    assert.equal(allowed.success, true)
  })
})

test('participate: depositor requires task-2; task-1 alone is not enough', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1020, { completedTasks: [WELVURA_TASK_1_ID] })
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'depositor' })).giveaway
        .id
    })

    const denied = withStore((store) => participateOnStore(store, giveawayId, 1020))
    assert.equal(denied.success, false)
    assert.equal(denied.requirement, 'depositor')

    const allowed = withStore((store) => {
      store.users['1020'].completedTasks = [WELVURA_TASK_1_ID, WELVURA_TASK_2_ID]
      return participateOnStore(store, giveawayId, 1020)
    })
    assert.equal(allowed.success, true)
  })
})

test('participate: depositor allows task-2 without requiring task-1 in check', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1021, { completedTasks: [WELVURA_TASK_2_ID] })
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'depositor' })).giveaway
        .id
    })
    const result = withStore((store) => participateOnStore(store, giveawayId, 1021))
    assert.equal(result.success, true)
  })
})

test('legacy kick row joins as all; legacy welvura_verified uses depositor rules', async () => {
  await withTempStore(async () => {
    const kickId = withStore((store) => {
      seedUser(store, 1030)
      const created = createGiveawayOnStore(store, validCreateBody({ eligibility: 'all' }))
      store.giveaways[created.giveaway.id].eligibility = 'kick'
      return created.giveaway.id
    })
    assert.equal(withStore((store) => participateOnStore(store, kickId, 1030)).success, true)

    const welvuraId = withStore((store) => {
      seedUser(store, 1031)
      const created = createGiveawayOnStore(store, validCreateBody({ eligibility: 'all' }))
      store.giveaways[created.giveaway.id].eligibility = 'welvura_verified'
      return created.giveaway.id
    })
    const denied = withStore((store) => participateOnStore(store, welvuraId, 1031))
    assert.equal(denied.success, false)
    assert.equal(denied.requirement, 'depositor')
    const allowed = withStore((store) => {
      store.users['1031'].completedTasks = [WELVURA_TASK_2_ID]
      return participateOnStore(store, welvuraId, 1031)
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

test('security: ineligible referral user cannot join; client completed claim is ignored', async () => {
  await withTempStore(async () => {
    const giveawayId = withStore((store) => {
      seedUser(store, 1006)
      return createGiveawayOnStore(store, validCreateBody({ eligibility: 'referral' })).giveaway
        .id
    })
    const result = withStore((store) => participateOnStore(store, giveawayId, 1006))
    assert.equal(result.success, false)
    assert.equal(result.code, 'GIVEAWAY_NOT_ELIGIBLE')
    withStore((store) => {
      assert.equal(Object.keys(store.giveawayParticipants || {}).length, 0)
      assert.equal(store.giveaways[giveawayId].participantsCount, 0)
    })

    // Server checks store user.completedTasks only — empty store user stays denied.
    assert.equal(
      checkGiveawayEligibility({ completedTasks: [] }, { eligibility: 'referral' }).eligible,
      false,
    )
  })
})
