import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat'

/** Invisible mount that reports Mini App presence while the user is authenticated. */
export function PresenceHeartbeat() {
  usePresenceHeartbeat()
  return null
}
