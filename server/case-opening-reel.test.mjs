import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CASE_OPENING_DURATION_MS,
  CASE_OPENING_REEL_LENGTH,
  CASE_OPENING_WINNER_INDEX_MAX,
  CASE_OPENING_WINNER_INDEX_MIN,
  buildCaseOpeningReel,
  computeReelTranslateX,
  randomIntInclusive,
  resolveWinnerReward,
} from '../src/lib/case-opening-reel.ts'

const pool = [
  {
    id: 'a',
    name: 'A',
    amount: 100,
    currency: 'COINS',
    rarity: 'common',
    chance: 50,
    image: '/a.png',
  },
  {
    id: 'b',
    name: 'B',
    amount: 500,
    currency: 'COINS',
    rarity: 'rare',
    chance: 30,
    image: '/b.png',
  },
  {
    id: 'c',
    name: 'C',
    amount: 1000,
    currency: 'RUB',
    rarity: 'legendary',
    chance: 20,
    image: '/c.png',
  },
]

test('computeReelTranslateX centers winner under viewport midpoint', () => {
  const x = computeReelTranslateX({
    containerWidth: 400,
    itemWidth: 100,
    gap: 0,
    winnerIndex: 2,
  })
  // winner center at 250; container center 200 → -50
  assert.equal(x, -50)
})

test('buildCaseOpeningReel places backend winner exactly at winnerIndex', () => {
  const winner = pool[2]
  const reel = buildCaseOpeningReel({
    pool,
    winner,
    length: CASE_OPENING_REEL_LENGTH,
    winnerIndex: 42,
    rng: () => 0.2,
  })
  assert.equal(reel.winnerIndex, 42)
  assert.equal(reel.items.length, CASE_OPENING_REEL_LENGTH)
  assert.equal(reel.items[42].isWinner, true)
  assert.equal(reel.items[42].reward.id, 'c')
  assert.ok(reel.items.some((item) => !item.isWinner && item.reward.id !== 'c'))
})

test('winnerIndex stays within configured visual range when randomized', () => {
  for (let i = 0; i < 30; i += 1) {
    const reel = buildCaseOpeningReel({
      pool,
      winner: pool[0],
      rng: () => (i % 10) / 10,
    })
    assert.ok(reel.winnerIndex >= CASE_OPENING_WINNER_INDEX_MIN)
    assert.ok(reel.winnerIndex <= CASE_OPENING_WINNER_INDEX_MAX)
  }
})

test('resolveWinnerReward maps opening.rewardId to pool image', () => {
  const reward = resolveWinnerReward(pool, {
    openingId: 'op-1',
    caseId: 'poor',
    rewardId: 'b',
    rewardAmount: 500,
    rewardCurrency: 'COINS',
    pricePaid: 8999,
    prize: {
      id: 'b',
      name: 'B',
      amount: 500,
      currency: 'COINS',
      rarity: 'rare',
    },
    createdAt: '2026-09-08T00:00:00.000Z',
  })
  assert.equal(reward.id, 'b')
  assert.equal(reward.image, '/b.png')
})

test('opening duration constant is in the 5–8s target band', () => {
  assert.ok(CASE_OPENING_DURATION_MS >= 5_000)
  assert.ok(CASE_OPENING_DURATION_MS <= 8_000)
})

test('randomIntInclusive is inclusive on both ends', () => {
  assert.equal(randomIntInclusive(38, 40, () => 0), 38)
  assert.equal(randomIntInclusive(38, 40, () => 0.999), 40)
})
