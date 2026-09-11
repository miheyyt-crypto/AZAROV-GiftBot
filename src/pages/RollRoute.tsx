import { isDesktopRoll } from '@/lib/telegram'
import { RollDesktopPage } from '@/pages/RollDesktopPage'
import { RollPage } from '@/pages/RollPage'

/** Same /roll URL — Mobile vs Desktop presentation only. */
export function RollRoute() {
  return isDesktopRoll() ? <RollDesktopPage /> : <RollPage />
}
