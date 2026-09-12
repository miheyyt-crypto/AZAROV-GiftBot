import { useMemo } from 'react'

import { CommunityAccessBanner } from '@/components/CommunityAccessBanner'
import { DailyFreeCase } from '@/components/DailyFreeCase'
import { FreeCaseRequirementNudges } from '@/components/FreeCaseRequirementNudges'
import { GamesBannerGrid } from '@/components/GamesBannerGrid'
import { GiveawaysSection } from '@/components/GiveawaysSection'
import { HomeBannerSlider } from '@/components/HomeBannerSlider'
import { HomeUserHeader } from '@/components/HomeUserHeader'
import { LeaderboardPodium } from '@/components/LeaderboardPodium'
import { RecentDropsFeed } from '@/components/RecentDropsFeed'
import { ReferralBattleBanner } from '@/components/ReferralBattleBanner'
import { StreamStreakCard } from '@/components/StreamStreakCard'
import { useAuth } from '@/components/AuthGate'
import { getHomeBanners } from '@/data/banners'
import { useUserAccount } from '@/hooks/useUserAccount'
import { getFreeCaseRequirements } from '@/lib/free-case-requirements'

export function Home() {
  const { sessionReady } = useAuth()
  const banners = useMemo(() => getHomeBanners(), [])
  const account = useUserAccount()
  const requirements = getFreeCaseRequirements(account)
  const nudgeCount = sessionReady
    ? Number(!requirements.kickLinked) + Number(!requirements.telegramTaskCompleted)
    : 0

  return (
    <div className="ui-page">
      <HomeUserHeader />

      <div className="mt-4">
        <HomeBannerSlider banners={banners} />
      </div>

      <div className="mt-4">
        <ReferralBattleBanner />
      </div>

      <div className="mt-5">
        <DailyFreeCase />
      </div>

      <div className="mt-6">
        <StreamStreakCard />
      </div>

      <GamesBannerGrid className="mt-4" eager />

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

      {nudgeCount > 0 ? (
        <div
          className="shrink-0 transition-[height] duration-300"
          style={{ height: nudgeCount * 72 + 12 }}
          aria-hidden
        />
      ) : null}

      {sessionReady ? <FreeCaseRequirementNudges /> : null}
    </div>
  )
}
