/** In-memory Roll SSE subscribers. No second realtime stack — SSE only for Roll. */

const clients = new Set()

/**
 * @param {{ userId: number, write: (chunk: string) => void, close: () => void }} client
 */
export function addRollSseClient(client) {
  clients.add(client)
  return () => {
    clients.delete(client)
  }
}

export function getRollSseClientCount() {
  return clients.size
}

/**
 * Push a JSON snapshot to all subscribers (or filter by userId).
 * @param {object} payload
 * @param {{ userId?: number } | null} [options]
 */
export function broadcastRollSnapshot(payload, options = null) {
  if (!clients.size) {
    return
  }
  const filterUserId = options?.userId != null ? Number(options.userId) : null
  const body = `event: ROUND_UPDATED\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of [...clients]) {
    if (filterUserId != null && Number(client.userId) !== filterUserId) {
      continue
    }
    try {
      client.write(body)
    } catch {
      try {
        client.close()
      } catch {
        // ignore
      }
      clients.delete(client)
    }
  }
}

export function broadcastRollEvent(eventName, payload) {
  if (!clients.size) {
    return
  }
  const safeName = String(eventName || 'ROUND_UPDATED').replace(/[^\w.-]/g, '_')
  const body = `event: ${safeName}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of [...clients]) {
    try {
      client.write(body)
    } catch {
      try {
        client.close()
      } catch {
        // ignore
      }
      clients.delete(client)
    }
  }
}
