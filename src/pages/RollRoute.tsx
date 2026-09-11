import { isAndroidTelegramMiniApp } from '@/lib/android-roll-runtime'
import { isDesktopRoll } from '@/lib/telegram'
import { AndroidRollPage } from '@/pages/AndroidRollPage'
import { RollDesktopPage } from '@/pages/RollDesktopPage'
import { RollPage } from '@/pages/RollPage'

/**
 * Same /roll URL.
 * Desktop → existing desktop shell + useRollGame
 * Android Telegram → dedicated Android runtime
 * iOS / other mobile → existing useRollGame
 */
export function RollRoute() {
  if (isDesktopRoll()) {
    return <RollDesktopPage />
  }
  if (isAndroidTelegramMiniApp()) {
    return <AndroidRollPage />
  }
  return <RollPage />
}
