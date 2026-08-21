import { useEffect, useState } from 'react'

import { HomeSectionTitle } from '@/components/HomeSectionTitle'
import { fetchRecentDrops, formatTimeAgo, getPlayerInitial } from '@/lib/home'
import { HOME_FEED_POLL_MS } from '@/lib/constants'
import { RARITY_LABELS, type CaseRewardRarity } from '@/types/case'
import type { RecentCaseDrop } from '@/types/home'

const rarityBorder: Record<CaseRewardRarity, string> = {
  legendary: 'border-gold/50',
  epic: 'border-neon-purple/50',
  rare: 'border-sky-400/40',
  common: 'border-white/10',
}

const rarityText: Record<CaseRewardRarity, string> = {
  legendary: 'text-gold',
  epic: 'text-neon-purple',
  rare: 'text-sky-300',
  common: 'text-muted',
}

function DropCard({ drop }: { drop: RecentCaseDrop }) {
  const initial = getPlayerInitial(drop.displayName)

  return (
    <article
      className={[
        'w-[168px] shrink-0 snap-start rounded-[20px] border bg-white/[0.03] p-3 backdrop-blur-sm',
        rarityBorder[drop.rarity],
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <div className="size-7 shrink-0 overflow-hidden rounded-full border border-white/10 bg-gradient-to-br from-purple to-neon-purple">
          {drop.photoUrl ? (
            <img src={drop.photoUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-[10px] font-bold text-white">
              {initial}
            </div>
          )}
        </div>
        <p className="min-w-0 truncate text-xs font-medium text-white">{drop.displayName}</p>
      </div>

      <p className="mt-3 text-base font-bold leading-tight text-white">{drop.prizeName}</p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={`text-[11px] font-medium ${rarityText[drop.rarity]}`}>
          {RARITY_LABELS[drop.rarity]}
        </span>
        <span className="text-[11px] text-muted">{formatTimeAgo(drop.createdAt)}</span>
      </div>
    </article>
  )
}

export function RecentDropsFeed() {
  const [drops, setDrops] = useState<RecentCaseDrop[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const list = await fetchRecentDrops()
      if (cancelled || list === null) {
        return
      }

      setDrops(list)
      setIsLoading(false)
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, HOME_FEED_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return (
    <section className="mb-2">
      <HomeSectionTitle title="Только что выпало" />

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted">Загружаем выпадения...</p>
      ) : drops.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Пока никто не открывал кейсы</p>
      ) : (
        <div className="scrollbar-hide -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 snap-x snap-mandatory">
          {drops.map((drop) => (
            <DropCard key={drop.id} drop={drop} />
          ))}
        </div>
      )}
    </section>
  )
}
