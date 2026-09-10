import { ChevronRight } from 'lucide-react'

import { RewardBadge } from '@/components/RewardBadge'
import type { PartnerTheme } from '@/types'

interface PartnerBannerProps {
  name: string
  description: string
  reward: number
  theme: PartnerTheme
  rewardSuffix?: string
  image?: string
  /** Completed partner tasks; lit dashes = completedCount + 1 (capped). */
  completedCount?: number
  onClick?: () => void
}

const themeStyles: Record<
  PartnerTheme,
  {
    container: string
    accent: string
    dots: string
    imageMode: 'character' | 'cover'
    imageClass: string
  }
> = {
  dragonmoney: {
    container:
      'border-[#c47a3a]/30 bg-gradient-to-r from-[#6b3a16] via-[#3a2012] to-[#151018] shadow-[0_8px_24px_rgb(0_0_0/25%)]',
    accent: 'text-white',
    dots: 'bg-[#e8a85a]',
    imageMode: 'character',
    imageClass:
      'absolute right-[7px] bottom-[-4px] h-[112px] w-auto max-w-[42%] object-contain drop-shadow-[0_8px_24px_rgb(0_0_0/45%)]',
  },
  stake: {
    container:
      'border-[#1ec7fc]/28 bg-gradient-to-r from-[#083a55] via-[#0a2038] to-[#0b0e18] shadow-[0_8px_24px_rgb(0_0_0/25%)]',
    accent: 'text-white',
    dots: 'bg-[#1ec7fc]',
    imageMode: 'character',
    imageClass:
      'absolute right-[11px] bottom-4 h-[66px] w-auto max-w-[40%] object-contain drop-shadow-[0_8px_24px_rgb(0_0_0/45%)]',
  },
}

const DOT_COUNT = 12

export function PartnerBanner({
  name,
  description,
  reward,
  theme,
  rewardSuffix,
  image,
  completedCount = 0,
  onClick,
}: PartnerBannerProps) {
  const styles = themeStyles[theme]
  const isCharacter = styles.imageMode === 'character'
  const litCount = Math.min(
    DOT_COUNT,
    Math.max(1, Math.floor(completedCount) + 1),
  )

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'relative w-full overflow-hidden rounded-[22px] border p-5 text-left min-h-[156px]',
        styles.container,
      ].join(' ')}
    >
      {image && isCharacter && (
        <img
          src={image}
          alt=""
          className={['pointer-events-none', styles.imageClass].join(' ')}
          aria-hidden
          loading="lazy"
          decoding="async"
        />
      )}

      {image && !isCharacter && (
        <img
          src={image}
          alt=""
          className="pointer-events-none absolute inset-0 size-full object-cover opacity-30"
          aria-hidden
          loading="lazy"
          decoding="async"
        />
      )}

      <div className="relative z-10 flex min-h-[116px] flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className={['min-w-0', isCharacter ? 'max-w-[58%]' : 'flex-1'].join(' ')}>
            <h3 className={`text-xl font-bold ${styles.accent}`}>{name}</h3>
            <p className="mt-1 text-sm text-white/75">{description}</p>
          </div>
          <RewardBadge reward={reward} suffix={rewardSuffix} size="lg" />
        </div>

        <div className="mt-auto pt-5">
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: DOT_COUNT }, (_, index) => (
              <span
                key={index}
                className={[
                  'h-1 w-3 rounded-full transition-colors duration-300',
                  index < litCount ? styles.dots : 'bg-white/20',
                ].join(' ')}
              />
            ))}
          </div>

          <div
            className={`mt-3 flex items-center gap-1 text-sm font-medium ${styles.accent}`}
          >
            Смотреть задания
            <ChevronRight size={16} aria-hidden />
          </div>
        </div>
      </div>
    </button>
  )
}
