import { useCallback, useEffect, useRef, useState } from 'react'

import { NotificationsSheet } from '@/components/NotificationsSheet'
import { ServerNotificationToast } from '@/components/ServerNotificationToast'
import { emitNotificationsUpdated } from '@/lib/notification-events'
import { fetchNotifications } from '@/lib/notifications'
import {
  SERVER_TOAST_DURATION_MS,
  SERVER_TOAST_POLL_MS,
  appendToastQueue,
  buildServerToastCopy,
  createServerToastSession,
  ingestPolledNotifications,
  shiftToastQueue,
} from '@/lib/notification-toast-logic'
import type { UserNotification } from '@/types/user-notification'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Polls GET /api/notifications and shows top toasts for notifications
 * that appear after the session baseline. Does not mark notifications read.
 */
export function ServerNotificationToasts() {
  const sessionRef = useRef(createServerToastSession())
  const queueRef = useRef<UserNotification[]>([])
  const dismissTimerRef = useRef<number | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const pausedByHoverRef = useRef(false)
  const remainingMsRef = useRef(SERVER_TOAST_DURATION_MS)
  const shownAtRef = useRef(0)

  const [current, setCurrent] = useState<UserNotification | null>(null)
  const [sheetFocusId, setSheetFocusId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current != null) {
      window.clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const showNextFromQueue = useCallback(() => {
    const { next, remaining } = shiftToastQueue(queueRef.current)
    queueRef.current = remaining
    setCurrent(next)
  }, [])

  const dismissCurrent = useCallback(() => {
    clearDismissTimer()
    pausedByHoverRef.current = false
    remainingMsRef.current = SERVER_TOAST_DURATION_MS
    setCurrent(null)
  }, [clearDismissTimer])

  const scheduleDismiss = useCallback(
    (ms: number) => {
      clearDismissTimer()
      shownAtRef.current = Date.now()
      remainingMsRef.current = ms
      dismissTimerRef.current = window.setTimeout(() => {
        dismissTimerRef.current = null
        setCurrent(null)
      }, ms)
    },
    [clearDismissTimer],
  )

  useEffect(() => {
    setReducedMotion(prefersReducedMotion())
  }, [])

  // When current clears, pull next queued toast (one at a time).
  useEffect(() => {
    if (current) {
      if (!pausedByHoverRef.current) {
        scheduleDismiss(SERVER_TOAST_DURATION_MS)
      }
      return () => clearDismissTimer()
    }
    if (queueRef.current.length > 0) {
      showNextFromQueue()
    }
    return undefined
  }, [current, scheduleDismiss, clearDismissTimer, showNextFromQueue])

  const enqueueNew = useCallback(
    (incoming: UserNotification[]) => {
      if (!incoming.length) {
        return
      }
      queueRef.current = appendToastQueue(queueRef.current, incoming)
      setCurrent((prev) => {
        if (prev) {
          return prev
        }
        const { next, remaining } = shiftToastQueue(queueRef.current)
        queueRef.current = remaining
        return next
      })
    },
    [],
  )

  const pollOnce = useCallback(async () => {
    if (inFlightRef.current) {
      return
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return
    }

    inFlightRef.current = true
    try {
      const result = await fetchNotifications(50)
      emitNotificationsUpdated({ unreadCount: result.unreadCount })
      const { newlyQueued } = ingestPolledNotifications(
        sessionRef.current,
        result.notifications,
      )
      enqueueNew(newlyQueued)
    } catch {
      // Silent retry on next interval — do not toast API failures.
    } finally {
      inFlightRef.current = false
    }
  }, [enqueueNew])

  useEffect(() => {
    let cancelled = false

    const clearPoll = () => {
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }

    const startPoll = () => {
      clearPoll()
      pollTimerRef.current = window.setInterval(() => {
        if (!cancelled) {
          void pollOnce()
        }
      }, SERVER_TOAST_POLL_MS)
    }

    void pollOnce()
    startPoll()

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void pollOnce()
        startPoll()
      } else {
        clearPoll()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearPoll()
      clearDismissTimer()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pollOnce, clearDismissTimer])

  const copy = current ? buildServerToastCopy(current) : null

  function handleOpen() {
    if (!current) {
      return
    }
    const id = current.id
    dismissCurrent()
    setSheetFocusId(id)
    setSheetOpen(true)
  }

  function handleSheetClose() {
    setSheetOpen(false)
    setSheetFocusId(null)
  }

  function handlePointerEnter() {
    if (!current || dismissTimerRef.current == null) {
      return
    }
    const elapsed = Date.now() - shownAtRef.current
    remainingMsRef.current = Math.max(500, remainingMsRef.current - elapsed)
    pausedByHoverRef.current = true
    clearDismissTimer()
  }

  function handlePointerLeave() {
    if (!current || !pausedByHoverRef.current) {
      return
    }
    pausedByHoverRef.current = false
    scheduleDismiss(remainingMsRef.current)
  }

  return (
    <>
      {current && copy ? (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[210] mx-auto flex w-full max-w-lg justify-center px-4"
          style={{ paddingTop: 'calc(0.75rem + var(--safe-area-top))' }}
        >
          <div
            className="pointer-events-auto w-full"
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
          >
            <ServerNotificationToast
              copy={copy}
              reducedMotion={reducedMotion}
              onOpen={handleOpen}
              onDismiss={dismissCurrent}
            />
          </div>
        </div>
      ) : null}

      {sheetOpen ? (
        <NotificationsSheet
          onClose={handleSheetClose}
          focusNotificationId={sheetFocusId}
          onUnreadChange={(count) => emitNotificationsUpdated({ unreadCount: count })}
        />
      ) : null}
    </>
  )
}
