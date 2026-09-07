import { Clock, Coins, MessageCircle, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ProfileSheet } from '@/components/ProfileSheet'
import { formatBalance } from '@/lib/balance'
import {
  claimAchievementReward,
  fetchAchievements,
  formatProgress,
} from '@/lib/profile'
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

function resolveStatus(item: AchievementProgress): string {
  if (item.status) return item.status
  if (item.claimed) return 'claimed'
  if (item.completed) return 'claimable'
  return 'in_progress'
}

function AchievementCard({
  item,
  claiming,
  error,
  onClaim,
}: {
  item: AchievementProgress
  claiming: boolean
  error: string | null
  onClaim: () => void
}) {
  const Icon = iconMap[item.icon]
  const percent = item.target > 0 ? Math.min(100, (item.current / item.target) * 100) : 0
  const status = resolveStatus(item)

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

      {status === 'claimable' ? (
        <button
          type="button"
          className="mt-4 w-full rounded-2xl bg-gold/90 px-4 py-3 text-sm font-semibold text-black transition enabled:active:scale-[0.98] disabled:opacity-60"
          disabled={claiming}
          onClick={onClaim}
        >
          {claiming ? 'Начисляем…' : `🎁 Забрать ${formatBalance(item.reward)} 🪙`}
        </button>
      ) : null}

      {status === 'claimed' ? (
        <p className="mt-4 text-center text-sm font-medium text-emerald-300">
          ✓ Награда получена
        </p>
      ) : null}

      {error ? <p className="mt-2 text-center text-xs text-pink">{error}</p> : null}
    </article>
  )
}

export function AchievementsSheet({ onClose }: AchievementsSheetProps) {
  const [achievements, setAchievements] = useState<AchievementProgress[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    void fetchAchievements().then((list) => {
      setAchievements(list)
      setIsLoading(false)
    })
  }, [])

  async function handleClaim(achievementId: string) {
    if (claimingId) {
      return
    }

    setClaimingId(achievementId)
    setErrors((prev) => {
      const next = { ...prev }
      delete next[achievementId]
      return next
    })

    try {
      const result = await claimAchievementReward(achievementId)
      if (result.achievements.length) {
        setAchievements(result.achievements)
      } else if (result.achievement) {
        setAchievements((prev) =>
          prev.map((item) => (item.id === result.achievement?.id ? result.achievement! : item)),
        )
      }

      if (!result.success) {
        setErrors((prev) => ({
          ...prev,
          [achievementId]: result.message || 'Не удалось получить награду.',
        }))
      }
    } catch {
      setErrors((prev) => ({
        ...prev,
        [achievementId]: 'Не удалось получить награду. Попробуй ещё раз.',
      }))
    } finally {
      setClaimingId(null)
    }
  }

  return (
    <ProfileSheet title="Достижения" onClose={onClose}>
      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted">Загружаем достижения...</p>
      ) : achievements.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Достижения пока недоступны</p>
      ) : (
        <div className="space-y-3">
          {achievements.map((item) => (
            <AchievementCard
              key={item.id}
              item={item}
              claiming={claimingId === item.id}
              error={errors[item.id] || null}
              onClaim={() => void handleClaim(item.id)}
            />
          ))}
        </div>
      )}
    </ProfileSheet>
  )
}
