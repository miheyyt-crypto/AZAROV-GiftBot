interface XPProgressProps {
  level: number
  xp: number
  nextLevelXp: number
}

export function XPProgress({ level, xp, nextLevelXp }: XPProgressProps) {
  const progress = nextLevelXp > 0 ? Math.min((xp / nextLevelXp) * 100, 100) : 0
  const formattedXp = new Intl.NumberFormat('ru-RU').format(xp)
  const formattedNext = new Intl.NumberFormat('ru-RU').format(nextLevelXp)

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-white">Уровень {level}</span>
        <span className="text-[#c4b5fd]">
          {formattedXp} / {formattedNext} XP
        </span>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={xp}
        aria-valuemin={0}
        aria-valuemax={nextLevelXp}
        aria-label={`Прогресс до следующего уровня: ${xp} из ${nextLevelXp} XP`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-neon-purple to-pink transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
