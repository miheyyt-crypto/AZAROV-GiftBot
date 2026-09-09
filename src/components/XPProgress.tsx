import { CoinIcon } from '@/components/CoinIcon'
import { nextLevelRewardAmount } from '@/lib/level-rewards'

interface XPProgressProps {
  level: number
  xp: number
  nextLevelXp: number
  currentLevelXp?: number
  nextLevelReward?: number
}

export function XPProgress({
  level,
  xp,
  nextLevelXp,
  currentLevelXp = 0,
  nextLevelReward,
}: XPProgressProps) {
  const span = Math.max(1, nextLevelXp - currentLevelXp)
  const into = Math.min(span, Math.max(0, xp - currentLevelXp))
  const progress = Math.min(100, (into / span) * 100)
  const formattedXp = new Intl.NumberFormat('ru-RU').format(xp)
  const formattedNext = new Intl.NumberFormat('ru-RU').format(nextLevelXp)
  const remainingXp = Math.max(0, nextLevelXp - xp)
  const reward = Math.max(
    0,
    Math.floor(Number(nextLevelReward) || nextLevelRewardAmount(level) || 0),
  )
  const formattedReward = new Intl.NumberFormat('ru-RU').format(reward)

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-white">
          Уровень {level} → {level + 1}
        </span>
        <span className="text-text-secondary">
          {formattedXp} / {formattedNext} XP
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={into}
        aria-valuemin={0}
        aria-valuemax={span}
        aria-label={`Прогресс до следующего уровня: ${xp} из ${nextLevelXp} XP`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-neon-purple to-pink transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-text-secondary">
        <span>До следующего уровня: {new Intl.NumberFormat('ru-RU').format(remainingXp)} XP</span>
        <span className="inline-flex items-center gap-1 font-medium text-gold">
          Награда: +{formattedReward}
          <CoinIcon className="size-3.5" />
        </span>
      </div>
    </div>
  )
}
