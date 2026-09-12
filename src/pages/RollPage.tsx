import { RollMobileView } from '@/components/roll/RollMobileView'
import { useRollGame } from '@/hooks/useRollGame'

/** iOS / non-Android mobile Roll — existing useRollGame runtime. */
export function RollPage() {
  const game = useRollGame()
  // Shell paints immediately; bets stay gated until bootstrapped (see useRollGame).
  return <RollMobileView game={game} />
}
