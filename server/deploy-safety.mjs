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

/**
 * Boot-time notice for production. Never pretends file lock spans replicas.
 * Exits only when AZAROV_ALLOW_MULTI_REPLICA=1 is missing AND an explicit
 * unsafe scale hint is set (ops override for emergency experiments).
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
