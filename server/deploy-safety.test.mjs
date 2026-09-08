import assert from 'node:assert/strict'
import test from 'node:test'

import { createRateLimiter } from './rate-limit.mjs'
import {
  assertSingleReplicaDeployment,
  getDeploymentReplicaDiagnostics,
} from './deploy-safety.mjs'

test('createRateLimiter blocks after max hits in window', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3 })
  assert.equal(limiter.check('u1').allowed, true)
  assert.equal(limiter.check('u1').allowed, true)
  assert.equal(limiter.check('u1').allowed, true)
  const blocked = limiter.check('u1')
  assert.equal(blocked.allowed, false)
  assert.ok(blocked.retryAfterMs > 0)
  assert.equal(limiter.check('u2').allowed, true)
})

test('deploy diagnostics declare multi-replica unsafe', () => {
  const previous = process.env.AZAROV_ALLOW_MULTI_REPLICA
  delete process.env.AZAROV_ALLOW_MULTI_REPLICA
  try {
    const diag = getDeploymentReplicaDiagnostics()
    assert.equal(diag.multiReplicaSafe, false)
    assert.equal(diag.singleReplicaRequired, true)
    assert.equal(diag.allowMultiReplica, false)
    const boot = assertSingleReplicaDeployment({ isProduction: false })
    assert.equal(boot.multiReplicaSafe, false)
  } finally {
    if (previous === undefined) delete process.env.AZAROV_ALLOW_MULTI_REPLICA
    else process.env.AZAROV_ALLOW_MULTI_REPLICA = previous
  }
})
