import { useEffect, useRef } from 'react'

export const REVIEW_STATUS_POLL_MS = 4_000

export type ReviewFinalStatus = 'approved' | 'rejected'

type PollResult<T> = {
  status: string | null | undefined
  payload?: T
}

/**
 * While `active` is true, polls until status becomes approved/rejected once.
 * Does not fire for statuses that were already final before watching started —
 * only transitions observed after `active` became true (poll must return pending
 * at least once, or caller marks watched ids separately).
 *
 * For simple single-request flows: set active when local status is pending.
 */
export function usePendingReviewPoll<T = unknown>(options: {
  active: boolean
  pollMs?: number
  poll: () => Promise<PollResult<T> | null>
  onResolved: (status: ReviewFinalStatus, payload?: T) => void
}) {
  const { active, pollMs = REVIEW_STATUS_POLL_MS, poll, onResolved } = options
  const onResolvedRef = useRef(onResolved)
  const pollRef = useRef(poll)
  const handledRef = useRef(false)

  onResolvedRef.current = onResolved
  pollRef.current = poll

  useEffect(() => {
    if (!active) {
      handledRef.current = false
      return
    }

    handledRef.current = false
    let cancelled = false
    let timer: number | null = null
    let inFlight = false

    async function tick() {
      if (cancelled || handledRef.current || inFlight) {
        return
      }
      inFlight = true
      try {
        const result = await pollRef.current()
        if (cancelled || handledRef.current || !result) {
          return
        }
        const status = String(result.status || '').toLowerCase()
        if (status === 'approved' || status === 'rejected') {
          handledRef.current = true
          onResolvedRef.current(status, result.payload)
        }
      } catch {
        // Network blip — keep polling; do not close or toast.
      } finally {
        inFlight = false
      }
    }

    void tick()
    timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      void tick()
    }, pollMs)

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void tick()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      if (timer != null) {
        window.clearInterval(timer)
      }
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, pollMs])
}
