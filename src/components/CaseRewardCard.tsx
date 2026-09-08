import { RARITY_LABELS } from '@/types/case'
import type { CaseReward } from '@/types/case'

const rarityStyles: Record<CaseReward['rarity'], string> = {
  legendary: 'border-gold/50 bg-gold/10',
  epic: 'border-neon-purple/40 bg-neon-purple/10',
  rare: 'border-sky-400/40 bg-sky-400/10',
  common: 'border-white/10 bg-white/[0.04]',
}

const rarityText: Record<CaseReward['rarity'], string> = {
  legendary: 'text-gold',
  epic: 'text-neon-purple',
  rare: 'text-sky-300',
  common: 'text-muted',
}

interface CaseRewardCardProps {
  reward: CaseReward
}

export function CaseRewardCard({ reward }: CaseRewardCardProps) {
  return (
    <article
      className={[
        'overflow-hidden rounded-[20px] border',
        rarityStyles[reward.rarity],
      ].join(' ')}
    >
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-bg-surface/80 p-3">
        <img
          src={reward.image}
          alt=""
          className={[
            reward.currency === 'COINS'
              ? 'h-[49%] w-[49%] object-contain drop-shadow-[0_6px_14px_rgb(0_0_0/35%)]'
              : 'size-full object-cover',
          ].join(' ')}
        />
      </div>
      <div className="space-y-1 p-3">
        <h4 className="text-sm font-semibold leading-snug break-words text-white">{reward.name}</h4>
        <p className={`text-xs font-medium ${rarityText[reward.rarity]}`}>
          {RARITY_LABELS[reward.rarity]}
        </p>
        <p className="text-xs text-muted">{reward.chance}%</p>
      </div>
    </article>
  )
}
