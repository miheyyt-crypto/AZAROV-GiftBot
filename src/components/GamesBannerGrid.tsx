import { useNavigate } from 'react-router-dom'

import minesBanner from '@/assets/banners/mines-banner.webp'
import rollBanner from '@/assets/banners/roll-banner.jpg'
import towerBanner from '@/assets/banners/tower-banner.webp'
import { DeferredImage } from '@/components/DeferredImage'
import { GameBanner } from '@/components/GameBanner'
import { ROUTES } from '@/lib/constants'

type GamesBannerGridProps = {
  className?: string
  /** Home above-fold can eager-load; Shop should defer. */
  eager?: boolean
}

export function GamesBannerGrid({ className = '', eager = false }: GamesBannerGridProps) {
  const navigate = useNavigate()

  return (
    <div className={['grid grid-cols-2 gap-3', className].filter(Boolean).join(' ')}>
      {/* Same tile height as Mines/Tower squares: full width ≈ 2 cols → ~2.08:1 */}
      <button
        type="button"
        aria-label="Открыть Roll"
        onClick={() => navigate(ROUTES.roll)}
        className={[
          'game-banner relative col-span-2 aspect-[2.08/1] w-full min-w-0 overflow-hidden rounded-[20px]',
          'border border-white/10 bg-[#121018]',
          'shadow-[0_8px_20px_rgb(0_0_0/35%)]',
          'transition-transform duration-150 ease-out active:scale-[0.97]',
        ].join(' ')}
      >
        <DeferredImage
          src={rollBanner}
          alt=""
          aria-hidden="true"
          eager={eager}
          className="size-full object-cover"
        />
      </button>
      <GameBanner
        ariaLabel="Открыть Mines"
        image={minesBanner}
        imageEager={eager}
        onClick={() => navigate(ROUTES.mines)}
      />
      <GameBanner
        ariaLabel="Открыть Tower"
        image={towerBanner}
        imageEager={eager}
        onClick={() => navigate(ROUTES.tower)}
      />
    </div>
  )
}
