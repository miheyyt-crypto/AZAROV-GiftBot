import { Flame, Info, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useAuth } from '@/components/AuthGate'
import { CoinIcon } from '@/components/CoinIcon'
import { LiveStreamBanner } from '@/components/LiveStreamBanner'
import { fetchKickStreak } from '@/lib/kick'
import type { KickStreakInfo } from '@/types/kick'

function streakStreamsTitle(days: number): { count: number; label: string } {
  const n = Math.max(0, Math.floor(Number(days) || 0))
  const mod10 = n % 10
  const mod100 = n % 100
  let unit = 'стримов'
  if (mod10 === 1 && mod100 !== 11) {
    unit = 'стрим'
  } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    unit = 'стрима'
  }
  return { count: n, label: `${unit} подряд` }
}

export function StreamStreakCard() {
  const { sessionReady } = useAuth()
  const [streak, setStreak] = useState<KickStreakInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sessionReady) {
      setLoading(true)
      return
    }

    let cancelled = false

    const load = () => {
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
    }

    load()
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      load()
    }, 60_000)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        load()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [sessionReady])

  const connected = Boolean(streak?.kickConnected)
  const current = Number(streak?.currentStreak) || 0
  const progressCurrent =
    streak?.progressCurrent != null ? Number(streak.progressCurrent) || 0 : current
  const progressRequired = Math.max(
    1,
    streak?.progressRequired != null
      ? Number(streak.progressRequired) || 1
      : current + 1,
  )
  const nextReward = Math.max(0, Math.floor(Number(streak?.nextReward) || 0))
  const progressPercent = Math.min(100, (progressCurrent / progressRequired) * 100)
  const title = streakStreamsTitle(current)
  const isLive = Boolean(streak?.isLive)
  const channelSlug = streak?.channelSlug || streak?.channel

  return (
    <div className="space-y-3">
      {isLive ? (
        <LiveStreamBanner
          channelSlug={channelSlug}
          channelAvatarUrl={streak?.channelAvatarUrl}
        />
      ) : null}

      <article
        className={[
          'home-stream-card relative overflow-hidden rounded-[22px] border border-white/[0.08]',
          'bg-[linear-gradient(165deg,rgb(28_26_38/92%),rgb(14_12_22/96%))]',
          'px-3.5 py-3 shadow-[0_10px_28px_rgb(0_0_0/32%),inset_0_1px_0_rgb(255_255_255/5%)]',
        ].join(' ')}
      >
        <div className="flex items-start gap-3">
          <div
            className={[
              'flex size-11 shrink-0 items-center justify-center rounded-[14px]',
              'border border-[#f5d76e]/25 bg-[#f5d76e]/10 text-[#f5d76e]',
            ].join(' ')}
            aria-hidden
          >
            {!connected && !loading ? <Lock size={20} strokeWidth={2.1} /> : <Flame size={22} strokeWidth={2.1} />}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-tight tracking-tight text-white">
              {!loading && connected ? (
                <>
                  <span className="text-[#f5d76e]">{title.count}</span>
                  {` ${title.label}`}
                </>
              ) : (
                'Серия стримов'
              )}
            </h2>

            <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-white/55">
              <span>Следующий бонус:</span>
              <span className="inline-flex items-center gap-1 font-semibold text-[#f5d76e]">
                +{loading ? '…' : nextReward || '—'}
                {!loading && nextReward > 0 ? <CoinIcon className="size-3.5" /> : null}
              </span>
              <Info
                size={13}
                className="text-white/35"
                aria-label="Бонус за следующий день стрика"
              />
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2.5">
          <div
            className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuenow={progressCurrent}
            aria-valuemin={0}
            aria-valuemax={progressRequired}
            aria-label="Прогресс стрика"
          >
            <div
              className="h-full rounded-full bg-[#f5d76e] transition-[width] duration-500 ease-out"
              style={{ width: `${loading ? 0 : progressPercent}%` }}
            />
          </div>
          <span className="shrink-0 text-[12px] font-medium tabular-nums text-white/55">
            {loading ? '…' : `${progressCurrent}/${progressRequired}`}
          </span>
        </div>

        <p className="mt-2.5 text-[11px] leading-snug text-white/40">
          Напиши 10 сообщений в чат, чтобы стрик засчитался
        </p>
      </article>
    </div>
  )
}
