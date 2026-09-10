import { useMemo } from 'react'

import { CommunityAccessBanner } from '@/components/CommunityAccessBanner'
import { DailyFreeCase } from '@/components/DailyFreeCase'
import { GamesBannerGrid } from '@/components/GamesBannerGrid'
import { GiveawaysSection } from '@/components/GiveawaysSection'
import { HomeBannerSlider } from '@/components/HomeBannerSlider'
import { HomeUserHeader } from '@/components/HomeUserHeader'
import { LeaderboardPodium } from '@/components/LeaderboardPodium'
import { RecentDropsFeed } from '@/components/RecentDropsFeed'
import { StreamStreakCard } from '@/components/StreamStreakCard'
import { getHomeBanners } from '@/data/banners'

export function Home() {
  const banners = useMemo(() => getHomeBanners(), [])

  return (
    <div className="ui-page">
      <HomeUserHeader />

      <div className="mt-4">
        <DailyFreeCase />
      </div>

      <div className="mt-5">
        <HomeBannerSlider banners={banners} />
      </div>

      <div className="mt-6">
        <StreamStreakCard />
      </div>

      <GamesBannerGrid className="mt-4" />

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
