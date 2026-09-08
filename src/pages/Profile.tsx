import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { AchievementsSheet } from '@/components/AchievementsSheet'
import { useAuth } from '@/components/AuthGate'
import { CoinBalance } from '@/components/BalanceCard'
import { CoinHistorySheet } from '@/components/CoinHistorySheet'
import { InventorySheet } from '@/components/InventorySheet'
import { KickConnectCard } from '@/components/KickConnectCard'
import { PartnerTaskModal } from '@/components/PartnerTaskModal'
import { ProfileMenu } from '@/components/ProfileMenu'
import { ProfileWelvuraBanner } from '@/components/ProfileWelvuraBanner'
import { StatCard } from '@/components/StatCard'
import { UserAvatar } from '@/components/UserAvatar'
import { XPProgress } from '@/components/XPProgress'
import { getPartnerById } from '@/data/partners'
import { useBalance } from '@/hooks/useBalance'
import { useUserProfile } from '@/hooks/useUserProfile'
import { isMiniAppAuthAvailable } from '@/lib/auth'
import { ROUTES } from '@/lib/constants'
import type { ProfileMenuId } from '@/types/profile'

export function Profile() {
  const navigate = useNavigate()
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

  const welvuraPartner = getPartnerById('dragonmoney')
  const showLogout = isWebSession || (!isMiniAppAuthAvailable() && !isDemo)

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
    <div
      className="min-h-full overflow-x-hidden bg-bg-dark px-4 pb-6"
      style={{ paddingTop: 'calc(1rem + var(--safe-area-top))' }}
    >
      <header className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">Профиль</h1>
        <CoinBalance className="shrink-0" />
      </header>

      <section className="mb-5 flex items-center gap-3">
        <UserAvatar user={user} size="sm" />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-white">{displayName}</h2>
          <p className="truncate text-sm text-muted">{displayUsername}</p>
          {isDemo && (
            <p className="mt-1 text-[10px] text-neon-purple">Demo mode</p>
          )}
        </div>
      </section>

      <section
        className="mb-5 overflow-hidden rounded-[28px] border border-[#e8b84a]/45 p-5"
        style={{
          backgroundImage: [
            'radial-gradient(ellipse 95% 80% at 8% 0%, rgb(232 184 74 / 22%), transparent 55%)',
            'radial-gradient(ellipse 95% 80% at 92% 0%, rgb(232 184 74 / 18%), transparent 55%)',
            'radial-gradient(ellipse 70% 55% at 50% 18%, rgb(40 32 22 / 55%), transparent 70%)',
            'linear-gradient(180deg, #1a1620 0%, #12101a 100%)',
          ].join(', '),
          boxShadow: '0 0 0 1px rgb(232 184 74 / 8%), 0 8px 28px rgb(0 0 0 / 35%)',
        }}
      >
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.22em] text-[#9aa3b5]">
          Баланс
        </p>
        <p className="mt-3 flex items-center justify-center gap-2 text-[42px] font-bold leading-none text-[#f0c45a]">
          <span aria-hidden className="text-[34px]">🪙</span>
          {formatted}
        </p>

        <div className="mt-6 border-t border-white/8 pt-4">
          <XPProgress
            level={profile.level}
            xp={profile.xp}
            nextLevelXp={profile.nextLevelXp}
            currentLevelXp={profile.currentLevelXp}
          />
        </div>

        <div className="mt-5 flex gap-3">
          <StatCard
            theme="pink"
            value={stats.watchLabel}
            label={'на стримах'}
          />
          <StatCard
            theme="green"
            value={stats.chatMessages}
            label={'сообщений в\nчате'}
          />
        </div>
      </section>

      <div className="mb-4">
        <KickConnectCard />
      </div>

      <div className="mb-4">
        <ProfileWelvuraBanner onClick={() => setShowWelvuraModal(true)} />
      </div>

      <ProfileMenu onSelect={handleMenuSelect} showLogout={showLogout} />

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
