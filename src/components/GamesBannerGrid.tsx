import { useNavigate } from 'react-router-dom'

import minesBanner from '@/assets/banners/mines-banner.jpg'
import towerBanner from '@/assets/banners/tower-banner.png'
import { GameBanner } from '@/components/GameBanner'
import { ROUTES } from '@/lib/constants'

type GamesBannerGridProps = {
  className?: string
}

export function GamesBannerGrid({ className = '' }: GamesBannerGridProps) {
  const navigate = useNavigate()

  return (
    <div className={['grid grid-cols-2 gap-3', className].filter(Boolean).join(' ')}>
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
