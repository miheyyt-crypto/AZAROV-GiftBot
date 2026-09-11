import { useNavigate } from 'react-router-dom'

import minesBanner from '@/assets/banners/mines-banner.webp'
import towerBanner from '@/assets/banners/tower-banner.webp'
import { GameBanner } from '@/components/GameBanner'
import { ROUTES } from '@/lib/constants'

type GamesBannerGridProps = {
  className?: string
}

export function GamesBannerGrid({ className = '' }: GamesBannerGridProps) {
  const navigate = useNavigate()

  return (
    <div className={['grid grid-cols-2 gap-3', className].filter(Boolean).join(' ')}>
      {/* Same tile height as Mines/Tower squares: full width ≈ 2 cols → ~2.08:1 */}
      <button
        type="button"
        aria-label="Открыть Roll"
        onClick={() => navigate(ROUTES.roll)}
        className={[
          'game-banner relative col-span-2 flex aspect-[2.08/1] w-full min-w-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-[20px]',
          'border border-[rgb(255_106_43/35%)] bg-[linear-gradient(120deg,#1a1220_0%,#2a1830_45%,#1a1024_100%)]',
          'shadow-[0_8px_20px_rgb(0_0_0/35%)]',
          'transition-transform duration-150 ease-out active:scale-[0.97]',
        ].join(' ')}
      >
        <span className="text-4xl leading-none" aria-hidden>
          🍥
        </span>
        <span className="text-center">
          <span className="block text-xl font-bold tracking-wide text-white">Roll</span>
          <span className="mt-0.5 block text-xs font-medium text-white/55">PvP колесо удачи</span>
        </span>
      </button>
      <GameBanner
        ariaLabel="Открыть Mines"
        image={minesBanner}
        onClick={() => navigate(ROUTES.mines)}
      />
      <GameBanner
        ariaLabel="Открыть Tower"
        image={towerBanner}
        onClick={() => navigate(ROUTES.tower)}
      />
    </div>
  )
}
