import assert from 'node:assert/strict'
import test from 'node:test'

import {
  minesExtraHazardProbability,
  minesLossProbability,
  minesMultiplierBps,
  minesNaturalLossProbability,
  minesPotentialWin,
  MINES_DIFFICULTY_MULTIPLIER,
  MINES_GRID_SIZE,
  MINES_HOUSE_EDGE_BPS,
  MINES_MAX_LOSS_PROBABILITY,
} from './mines.mjs'

/**
 * Monte-Carlo of first-click outcomes under classic layout + optional extra hazard.
 * Mirrors server resolveMineHit math without the store.
 */
function simulateFirstClickLossRate({
  samples,
  mineCount,
  difficultyMultiplier,
  maxLossProbability = MINES_MAX_LOSS_PROBABILITY,
}) {
  let losses = 0
  let multiplierSum = 0
  let payoutSum = 0
  const bet = 100
  const natural = minesNaturalLossProbability(0, mineCount)
  const target = minesLossProbability(
    0,
    mineCount,
    MINES_GRID_SIZE,
    difficultyMultiplier,
    maxLossProbability,
  )
  const hazard = minesExtraHazardProbability(
    0,
    mineCount,
    MINES_GRID_SIZE,
    difficultyMultiplier,
    maxLossProbability,
  )

  for (let i = 0; i < samples; i += 1) {
    // Place mines, pick a random cell (player-agnostic prior).
    const cells = Array.from({ length: MINES_GRID_SIZE }, (_, idx) => idx)
    for (let a = cells.length - 1; a > 0; a -= 1) {
      const b = Math.floor(Math.random() * (a + 1))
      const tmp = cells[a]
      cells[a] = cells[b]
      cells[b] = tmp
    }
    const mineSet = new Set(cells.slice(0, mineCount))
    const pick = Math.floor(Math.random() * MINES_GRID_SIZE)
    let hit = mineSet.has(pick)
    if (!hit && hazard > 0 && Math.random() < hazard) {
      hit = true
    }
    if (hit) {
      losses += 1
    } else {
      const multBps = minesMultiplierBps(
        1,
        mineCount,
        MINES_GRID_SIZE,
        MINES_HOUSE_EDGE_BPS,
      )
      const payout = minesPotentialWin(
        bet,
        1,
        mineCount,
        MINES_GRID_SIZE,
        MINES_HOUSE_EDGE_BPS,
      )
      multiplierSum += multBps / 10_000
      payoutSum += payout
    }
  }

  const lossRate = losses / samples
  const survives = samples - losses
  return {
    samples,
    mineCount,
    difficultyMultiplier,
    natural,
    target,
    hazard,
    lossRate,
    avgMultiplierOnSurvive: survives ? multiplierSum / survives : 0,
    avgPayoutOnSurvive: survives ? payoutSum / survives : 0,
  }
}

test('simulation: difficulty×3 raises first-click loss ≈3× for 5 mines', () => {
  const samples = 200_000
  const current = simulateFirstClickLossRate({
    samples,
    mineCount: 5,
    difficultyMultiplier: 1,
    maxLossProbability: 1,
  })
  const next = simulateFirstClickLossRate({
    samples,
    mineCount: 5,
    difficultyMultiplier: MINES_DIFFICULTY_MULTIPLIER,
  })

  const ratio = next.lossRate / current.lossRate
  console.info('[mines-sim]', {
    currentLossRate: Number(current.lossRate.toFixed(4)),
    newLossRate: Number(next.lossRate.toFixed(4)),
    ratio: Number(ratio.toFixed(3)),
    currentAvgMult: Number(current.avgMultiplierOnSurvive.toFixed(4)),
    newAvgMult: Number(next.avgMultiplierOnSurvive.toFixed(4)),
    currentAvgPayout: Number(current.avgPayoutOnSurvive.toFixed(2)),
    newAvgPayout: Number(next.avgPayoutOnSurvive.toFixed(2)),
    targetNew: next.target,
  })

  assert.ok(current.lossRate > 0.18 && current.lossRate < 0.22)
  assert.ok(next.lossRate > 0.56 && next.lossRate < 0.64)
  assert.ok(ratio > 2.7 && ratio < 3.3)
  // Payouts / multipliers remain classic (unchanged by difficulty).
  assert.equal(Number(current.avgMultiplierOnSurvive.toFixed(4)), 1.2125)
  assert.equal(Number(next.avgMultiplierOnSurvive.toFixed(4)), 1.2125)
})

test('simulation: displayed mine count math stays at selected count', () => {
  // Target for 3 mines: 3/25*3 = 0.36 — still below cap.
  const next = simulateFirstClickLossRate({
    samples: 80_000,
    mineCount: 3,
    difficultyMultiplier: 3,
  })
  assert.ok(Math.abs(next.target - 0.36) < 1e-9)
  assert.ok(next.lossRate > 0.33 && next.lossRate < 0.39)
})
