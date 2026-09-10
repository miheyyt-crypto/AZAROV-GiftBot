import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { CoinIcon } from '@/components/CoinIcon'
import { AchievementsSheet } from '@/components/AchievementsSheet'
import { useAuth } from '@/components/AuthGate'
import { CoinBalance } from '@/components/BalanceCard'
import { CoinHistorySheet } from '@/components/CoinHistorySheet'
import { InventorySheet } from '@/components/InventorySheet'
import { KickConnectCard } from '@/components/KickConnectCard'
import { NotificationsSheet } from '@/components/NotificationsSheet'
import { PartnerTaskModal } from '@/components/PartnerTaskModal'
import { ProfileMenu } from '@/components/ProfileMenu'
import { ProfileWelvuraBanner } from '@/components/ProfileWelvuraBanner'
import { PromoCodeCard } from '@/components/PromoCodeCard'
import { StatCard } from '@/components/StatCard'
import { UserAvatar } from '@/components/UserAvatar'
import { XPProgress } from '@/components/XPProgress'
import { getPartnerById } from '@/data/partners'
import { useBalance } from '@/hooks/useBalance'
import { useUserProfile } from '@/hooks/useUserProfile'
import { isMiniAppAuthAvailable } from '@/lib/auth'
import { ROUTES } from '@/lib/constants'
import { fetchUnreadNotificationCount } from '@/lib/notifications'
import { subscribeNotificationsUpdated } from '@/lib/notification-events'
import type { ProfileMenuId } from '@/types/profile'

export function Profile() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { logout, isWebSession } = useAuth()
  const { formatted } = useBalance()
  const {
    user,
    profile,
    stats,
    isDemo,
    displayName,
    displayUsername,
  } = useUserProfile()

  const [activeSheet, setActiveSheet] = useState<ProfileMenuId | null>(null)
  const [showWelvuraModal, setShowWelvuraModal] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [highlightKick, setHighlightKick] = useState(false)

  const welvuraPartner = getPartnerById('dragonmoney')
  const showLogout = isWebSession || (!isMiniAppAuthAvailable() && !isDemo)

  useEffect(() => {
    const section = String(searchParams.get('section') || '').trim().toLowerCase()
    if (section !== 'kick') {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      const node = document.getElementById('kick-connect-section')
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightKick(true)
      window.setTimeout(() => setHighlightKick(false), 2400)
    })
    const next = new URLSearchParams(searchParams)
    next.delete('section')
    setSearchParams(next, { replace: true })
    return () => window.cancelAnimationFrame(frame)
  }, [searchParams, setSearchParams])

  useEffect(() => {
    let cancelled = false
    void fetchUnreadNotificationCount()
      .then((count) => {
        if (!cancelled) {
          setUnreadNotifications(count)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnreadNotifications(0)
        }
      })
    const unsubscribe = subscribeNotificationsUpdated((detail) => {
      if (!cancelled && typeof detail?.unreadCount === 'number') {
        setUnreadNotifications(detail.unreadCount)
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  async function handleMenuSelect(id: ProfileMenuId) {
    if (id === 'operations') {
      navigate(ROUTES.operations)
      return
    }
    if (id === 'orders') {
      navigate(ROUTES.orders)
      return
    }
    if (id === 'logout') {
      if (logoutBusy) {
        return
      }
      setLogoutBusy(true)
      try {
        await logout()
      } finally {
        setLogoutBusy(false)
      }
      return
    }
    setActiveSheet(id)
  }

  return (
    <div className="ui-page">
      <header className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">Профиль</h1>
        <CoinBalance className="shrink-0" />
      </header>

      <section className="mb-5 flex items-center gap-3">
        <UserAvatar user={user} size="sm" />
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold tracking-tight text-white">
            {displayName}
          </h2>
          <p className="truncate text-sm text-text-secondary">{displayUsername}</p>
          {isDemo && (
            <p className="mt-1 text-[10px] font-medium text-neon-purple">Демо-режим</p>
          )}
        </div>
      </section>

      <section className="ui-card-hero mb-5 border-gold/30 p-5">
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
          Баланс
        </p>
        <p className="mt-3 flex items-center justify-center gap-2 text-[40px] font-bold leading-none tracking-tight text-gold">
          <CoinIcon className="size-9" />
          <span className="tabular-nums">{formatted}</span>
        </p>

        <div className="mt-6 border-t border-white/[0.08] pt-4">
          <XPProgress
            level={profile.level}
            xp={profile.xp}
            nextLevelXp={profile.nextLevelXp}
            currentLevelXp={profile.currentLevelXp}
            nextLevelReward={profile.nextLevelReward}
          />
        </div>

        <div className="mt-5 flex gap-3">
          <StatCard
            theme="pink"
            value={stats.watchLabel}
            label={'активности\nна стриме'}
          />
          <StatCard
            theme="green"
            value={stats.chatMessages}
            label={'сообщений в\nчате'}
          />
        </div>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-white/55">
          Опыт начисляется за каждое сообщение в чате Kick и за каждую минуту
          просмотра стрима.
        </p>
      </section>

      <div className="mb-4">
        <PromoCodeCard />
      </div>

      <div
        id="kick-connect-section"
        className={[
          'mb-4 rounded-[22px] transition-[box-shadow,ring] duration-500',
          highlightKick ? 'ring-2 ring-kick/70 shadow-[0_0_24px_rgb(83_204_24/25%)]' : '',
        ].join(' ')}
      >
        <KickConnectCard />
      </div>

      <div className="mb-4">
        <ProfileWelvuraBanner onClick={() => setShowWelvuraModal(true)} />
      </div>

      <ProfileMenu
        onSelect={handleMenuSelect}
        showLogout={showLogout}
        unreadNotifications={unreadNotifications}
      />

      {activeSheet === 'notifications' && (
        <NotificationsSheet
          onClose={() => setActiveSheet(null)}
          onUnreadChange={setUnreadNotifications}
        />
      )}
      {activeSheet === 'coin-history' && (
        <CoinHistorySheet onClose={() => setActiveSheet(null)} />
      )}
      {activeSheet === 'inventory' && (
        <InventorySheet onClose={() => setActiveSheet(null)} />
      )}
      {activeSheet === 'achievements' && (
        <AchievementsSheet onClose={() => setActiveSheet(null)} />
      )}

      {showWelvuraModal && welvuraPartner && (
        <PartnerTaskModal
          partner={welvuraPartner}
          onClose={() => setShowWelvuraModal(false)}
        />
      )}
    </div>
  )
}
