import { Clock, Coins, MessageCircle, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ProfileSheet } from '@/components/ProfileSheet'
import { formatBalance } from '@/lib/balance'
import { fetchAchievements, formatProgress } from '@/lib/profile'
import type { AchievementProgress } from '@/types/profile'

interface AchievementsSheetProps {
  onClose: () => void
}

const iconMap = {
  clock: Clock,
  message: MessageCircle,
  users: Users,
  coins: Coins,
}

function AchievementCard({ item }: { item: AchievementProgress }) {
  const Icon = iconMap[item.icon]
  const percent = item.target > 0 ? Math.min(100, (item.current / item.target) * 100) : 0

  return (
    <article className="rounded-[20px] border border-white/10 bg-[#25252b] p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-muted">
          <Icon size={20} aria-hidden />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{item.title}</p>
        <div className="flex shrink-0 items-center gap-1 text-sm font-semibold text-gold">
          <span aria-hidden>🪙</span>
          {formatBalance(item.reward)}
        </div>
      </div>

      <div className="mt-4">
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-white/35 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-right text-xs text-muted">
          {formatProgress(item.current, item.target)}
        </p>
      </div>
    </article>
  )
}

export function AchievementsSheet({ onClose }: AchievementsSheetProps) {
  const [achievements, setAchievements] = useState<AchievementProgress[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void fetchAchievements().then((list) => {
      setAchievements(list)
      setIsLoading(false)
    })
  }, [])

  return (
    <ProfileSheet title="Достижения" onClose={onClose}>
      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted">Загружаем достижения...</p>
      ) : achievements.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Достижения пока недоступны</p>
      ) : (
        <div className="space-y-3">
          {achievements.map((item) => (
            <AchievementCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </ProfileSheet>
  )
}
