import { Trophy } from 'lucide-react'

import { formatWinnersLabel } from '@/lib/giveaways'
import type { Giveaway } from '@/types/giveaway'

interface GiveawayCardProps {
  giveaway: Giveaway
  onClick?: (giveaway: Giveaway) => void
}

export function GiveawayCard({ giveaway, onClick }: GiveawayCardProps) {
  return (
    <article
      className="interactive flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#141218]/95"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? () => onClick(giveaway) : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onClick(giveaway)
              }
            }
          : undefined
      }
    >
      <div className="aspect-[5/4] w-full shrink-0 overflow-hidden bg-black/40">
        <img
          src={giveaway.image}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          draggable={false}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <h3 className="truncate px-2.5 py-2 text-[13px] font-bold leading-tight tracking-tight text-white">
          {giveaway.title}
        </h3>

        <div className="mt-auto flex items-center gap-1.5 border-t border-white/[0.06] px-2.5 py-2">
          <Trophy size={13} className="shrink-0 text-muted" aria-hidden />
          <span className="truncate text-[11px] font-medium text-muted">
            {formatWinnersLabel(giveaway.winnersCount)}
          </span>
        </div>
      </div>
    </article>
  )
}
