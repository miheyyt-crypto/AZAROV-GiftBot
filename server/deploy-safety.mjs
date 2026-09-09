import cluster from 'node:cluster'

/**
 * JSON file store + file lock are single-process / single-replica only.
 * Multiple Railway replicas can race and double-spend / double-grant.
 * This module documents and surfaces that constraint — it is NOT a distributed lock.
 */

export function getDeploymentReplicaDiagnostics() {
  const railwayReplicaId = String(process.env.RAILWAY_REPLICA_ID || '').trim() || null
  const railwayReplicaRegion = String(process.env.RAILWAY_REPLICA_REGION || '').trim() || null
  const railwayDeploymentId = String(process.env.RAILWAY_DEPLOYMENT_ID || '').trim() || null
  const allowMulti = String(process.env.AZAROV_ALLOW_MULTI_REPLICA || '').trim() === '1'

  return {
    multiReplicaSafe: false,
    singleReplicaRequired: !allowMulti,
    allowMultiReplica: allowMulti,
    railwayReplicaId,
    railwayReplicaRegion,
    railwayDeploymentId,
  }
}

function readPositiveIntEnv(name) {
  const raw = String(process.env[name] || '').trim()
  if (!raw) {
    return 0
  }
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Detect process managers that would fork multiple writers against the JSON store.
 * Railway replica count is NOT visible here — that residual risk is documented in DEPLOYMENT.md.
 */
export function getUnsafeMultiProcessHints() {
  const hints = []
  const webConcurrency = readPositiveIntEnv('WEB_CONCURRENCY')
  if (webConcurrency > 1) {
    hints.push(`WEB_CONCURRENCY=${webConcurrency}`)
  }
  const pm2Instances = readPositiveIntEnv('PM2_INSTANCES')
  if (pm2Instances > 1) {
    hints.push(`PM2_INSTANCES=${pm2Instances}`)
  }
  // PM2 cluster / node cluster worker
  if (String(process.env.NODE_APP_INSTANCE || '').trim() !== '') {
    hints.push('NODE_APP_INSTANCE set (cluster worker)')
  }
  if (cluster.isWorker) {
    hints.push('node:cluster worker')
  }
  return hints
}

/**
 * Boot-time notice for production. Never pretends file lock spans replicas.
 * Exits when explicit multi-process hints are present (unless emergency override).
 */
export function assertSingleReplicaDeployment({ isProduction = false } = {}) {
  const diag = getDeploymentReplicaDiagnostics()

  if (!isProduction) {
    return diag
  }

  console.info('[deploy] JSON store requires a SINGLE Railway replica.', {
    multiReplicaSafe: false,
    railwayReplicaId: diag.railwayReplicaId,
    railwayDeploymentId: diag.railwayDeploymentId,
    note: 'File lock does not protect across replicas. Keep numReplicas=1 (railway.toml) and one Volume.',
  })

  const unsafe = getUnsafeMultiProcessHints()
  if (unsafe.length && !diag.allowMultiReplica) {
    console.error(
      `[deploy] Multi-process hints incompatible with JSON file store: ${unsafe.join(', ')}. Keep a single process (or set AZAROV_ALLOW_MULTI_REPLICA=1 only for emergency diagnostics).`,
    )
    process.exit(1)
  }

  if (diag.allowMultiReplica) {
    console.error(
      '[deploy] AZAROV_ALLOW_MULTI_REPLICA=1 — economy is NOT safe under horizontal scale. Use only for emergency diagnostics.',
    )
  }

  // Soft diagnostic only: Railway does not expose peer replica count to this process.
  if (diag.railwayReplicaId) {
    console.info('[deploy] RAILWAY_REPLICA_ID present (diagnostic)', {
      railwayReplicaId: diag.railwayReplicaId,
      railwayReplicaRegion: diag.railwayReplicaRegion,
    })
  }

  return diag
}
