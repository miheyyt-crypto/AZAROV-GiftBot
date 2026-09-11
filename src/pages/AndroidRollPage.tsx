import { RollMobileView } from '@/components/roll/RollMobileView'
import { useAndroidRollRuntime } from '@/hooks/useAndroidRollRuntime'

/** Android Telegram Mini App Roll — dedicated runtime, shared UI. */
export function AndroidRollPage() {
  const game = useAndroidRollRuntime()

  if (!game.bootstrapped) {
    return (
      <div className="ui-page">
        <div className="h-10 w-40 animate-pulse rounded-xl bg-white/[0.06]" />
        <div className="mt-4 aspect-square animate-pulse rounded-full bg-white/[0.04]" />
      </div>
    )
  }

  return <RollMobileView game={game} />
}
