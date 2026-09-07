import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'

import { fetchKickStreak } from '@/lib/kick'
import type { KickStreakInfo } from '@/types/kick'

function streakHeadline(days: number): string {
  if (days === 1) {
    return '🔥 1 день подряд'
  }
  if (days >= 2 && days <= 4) {
    return `🔥 ${days} дня подряд`
  }
  return `🔥 ${days} дней подряд`
}

export function StreamStreakCard() {
  const [streak, setStreak] = useState<KickStreakInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetchKickStreak()
      .then((data) => {
        if (!cancelled) {
          setStreak(data)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const connected = Boolean(streak?.kickConnected)
  const current = Number(streak?.currentStreak) || 0
  const creditedToday = Boolean(streak?.creditedToday)
  const freezeAvailable = Number(streak?.freezeAvailable) || 0

  let title = 'Стрик стримов'
  let subtitle = 'Загрузка…'

  if (!loading && streak) {
    if (!connected) {
      subtitle = streak.message || 'Привяжи Kick, чтобы участвовать в стрике'
    } else if (current > 0) {
      title = streakHeadline(current)
      subtitle = creditedToday
        ? 'День засчитан за активность в чате стрима'
        : streak.message || 'Сегодня ещё не засчитано'
    } else {
      title = '🔥 Стрик стримов'
      subtitle = streak.message || 'Напиши в чат во время стрима, чтобы начать стрик'
    }
  } else if (!loading && !streak) {
    subtitle = 'Не удалось загрузить стрик'
  }

  return (
    <article className="relative flex items-center gap-4 overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-gold/25 bg-gold/10 text-2xl text-gold">
        {!connected && !loading ? <Lock size={22} aria-hidden /> : <span aria-hidden>🔥</span>}
      </div>

      <div className="relative z-10 min-w-0 flex-1">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>
        {connected && !loading && streak ? (
          <p className="mt-1.5 text-xs text-white/70">🧊 Заморозок: {freezeAvailable}</p>
        ) : null}
      </div>
    </article>
  )
}
