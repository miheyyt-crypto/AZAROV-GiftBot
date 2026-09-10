import { useEffect } from 'react'

import { useAuth } from '@/components/AuthGate'
import { pingPresence } from '@/lib/presence'

const PRESENCE_PING_INTERVAL_MS = 30_000

/**
 * Keeps the current Mini App / web session marked online for admin counters.
 * Mount only inside authenticated AuthGate children; waits for server session.
 */
export function usePresenceHeartbeat() {
  const { sessionReady } = useAuth()

  useEffect(() => {
    if (!sessionReady) {
      return
    }

    let cancelled = false

    function send() {
      if (cancelled) {
        return
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      void pingPresence()
    }

    send()
    const timer = window.setInterval(send, PRESENCE_PING_INTERVAL_MS)

    function onVisible() {
      if (document.visibilityState === 'visible') {
        send()
      }
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [sessionReady])
}
