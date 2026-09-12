import { RollMobileView } from '@/components/roll/RollMobileView'
import { useAndroidRollRuntime } from '@/hooks/useAndroidRollRuntime'

/** Android Telegram Mini App Roll — dedicated runtime, shared UI. */
export function AndroidRollPage() {
  const game = useAndroidRollRuntime()
  // Shell paints immediately; bets stay gated until bootstrapped (see useAndroidRollRuntime).
  return <RollMobileView game={game} />
}
