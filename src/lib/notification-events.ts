const EVENT = 'azarov:notifications-updated'

export function emitNotificationsUpdated(detail: { unreadCount: number }): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail }))
}

export function subscribeNotificationsUpdated(
  listener: (detail: { unreadCount: number }) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }
  const handler = (event: Event) => {
    const custom = event as CustomEvent<{ unreadCount: number }>
    listener(custom.detail)
  }
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
