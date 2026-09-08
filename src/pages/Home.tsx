import { useMemo } from 'react'

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

      <HomeBannerSlider banners={banners} />

      <div className="mt-6">
        <StreamStreakCard />
      </div>

      <div className="mt-6">
        <LeaderboardPodium />
      </div>

      <RecentDropsFeed />
    </div>
  )
}
