import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

import { CommunityAccessBanner } from '@/components/CommunityAccessBanner'
import { GiveawaysSection } from '@/components/GiveawaysSection'
import { HomeBannerSlider } from '@/components/HomeBannerSlider'
import { HomeUserHeader } from '@/components/HomeUserHeader'
import { LeaderboardPodium } from '@/components/LeaderboardPodium'
import { RecentDropsFeed } from '@/components/RecentDropsFeed'
import { StreamStreakCard } from '@/components/StreamStreakCard'
import { getHomeBanners } from '@/data/banners'
import { ROUTES } from '@/lib/constants'

export function Home() {
  const navigate = useNavigate()
  const banners = useMemo(() => getHomeBanners(), [])

  return (
    <div className="ui-page">
      <HomeUserHeader />

      <HomeBannerSlider banners={banners} />

      <div className="mt-6">
        <StreamStreakCard />
      </div>

      <button
        type="button"
        onClick={() => navigate(ROUTES.mines)}
        className="mt-4 flex min-h-[68px] w-full items-center justify-between rounded-[20px] border border-[rgb(139_61_255/30%)] bg-[linear-gradient(110deg,#18122a,#10141c)] px-4 py-3 text-left shadow-[0_0_20px_rgb(139_61_255/12%)] transition active:scale-[0.99]"
      >
        <span>
          <span className="block text-sm font-bold text-white">💣 Mines</span>
          <span className="mt-0.5 block text-xs text-[#9b96ab]">Играй на монеты · от 100</span>
        </span>
        <span className="rounded-full bg-[rgb(139_61_255/20%)] px-3 py-1 text-xs font-semibold text-[#d2b4ff]">
          Играть
        </span>
      </button>

      <button
        type="button"
        onClick={() => navigate(ROUTES.tower)}
        className="mt-3 flex min-h-[68px] w-full items-center justify-between rounded-[20px] border border-[rgb(244_201_93/28%)] bg-[linear-gradient(110deg,#1a1628,#12141c)] px-4 py-3 text-left shadow-[0_0_20px_rgb(244_201_93/10%)] transition active:scale-[0.99]"
      >
        <span>
          <span className="block text-sm font-bold text-white">🏗️ Tower</span>
          <span className="mt-0.5 block text-xs text-[#9b96ab]">Поднимайся выше · от 100</span>
        </span>
        <span className="rounded-full bg-[rgb(244_201_93/18%)] px-3 py-1 text-xs font-semibold text-gold">
          Играть
        </span>
      </button>

      <div className="mt-6">
        <GiveawaysSection />
      </div>

      <div className="mt-6">
        <LeaderboardPodium />
      </div>

      <RecentDropsFeed />

      <div className="mt-6">
        <CommunityAccessBanner />
      </div>
    </div>
  )
}
