import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useNotifications } from '@/components/NotificationProvider'
import { ReferralProgress } from '@/components/ReferralProgress'
import { applyAccountSnapshot } from '@/lib/account'
import { getReferralMe } from '@/lib/api'
import { formatBalance, hydrateBalanceFromAccount } from '@/lib/balance'
import {
  buildReferralLink,
  copyText,
  getReferralCaseStats,
  shareReferralLink,
} from '@/lib/referral'
import { mapRemoteAccount } from '@/lib/session'
import type { UserAccount } from '@/types/account'

interface ReferralInviteCardProps {
  account: UserAccount
}

interface ServerReferralMe {
  referralLink: string
  caseProgress: number
  caseTarget: number
}

export function ReferralInviteCard({ account }: ReferralInviteCardProps) {
  const { showNotification } = useNotifications()
  const [isSharing, setIsSharing] = useState(false)
  const [serverMe, setServerMe] = useState<ServerReferralMe | null>(null)
  const caseStats = getReferralCaseStats(account)
  const referralLink =
    serverMe?.referralLink || account.referralLink || buildReferralLink(account.referralCode)
  const progressCurrent = serverMe?.caseProgress ?? caseStats.currentProgress
  const progressTarget = serverMe?.caseTarget ?? caseStats.progressTarget

  useEffect(() => {
    let cancelled = false

    void getReferralMe()
      .then((result) => {
        if (cancelled || !result.success) {
          return
        }

        if (result.user) {
          applyAccountSnapshot(mapRemoteAccount(result.user))
          hydrateBalanceFromAccount()
        }

        if (result.referralLink) {
          setServerMe({
            referralLink: result.referralLink,
            caseProgress: typeof result.caseProgress === 'number' ? result.caseProgress : 0,
            caseTarget: typeof result.caseTarget === 'number' ? result.caseTarget : 5,
          })
        }
      })
      .catch(() => {
        // Keep the last server snapshot from session bootstrap.
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleCopy() {
    if (!referralLink) {
      showNotification({
        type: 'warning',
        title: 'Ссылка недоступна',
        message: 'Открой приложение в Telegram, чтобы получить ссылку',
      })
      return
    }

    await copyText(referralLink)
    showNotification({
      type: 'success',
      title: 'Готово',
      message: 'Ссылка скопирована',
    })
  }

  async function handleShare() {
    if (!referralLink) {
      showNotification({
        type: 'warning',
        title: 'Ссылка недоступна',
        message: 'Открой приложение в Telegram, чтобы получить ссылку',
      })
      return
    }

    setIsSharing(true)

    try {
      const result = await shareReferralLink(referralLink)
      if (result === 'copied') {
        showNotification({
          type: 'success',
          title: 'Готово',
          message: 'Ссылка скопирована',
        })
      }
    } finally {
      setIsSharing(false)
    }
  }

  return (
    <div className="space-y-3.5">
      <section className="rounded-[24px] border border-neon-purple/25 bg-[#16121f]/95 p-5 shadow-[0_8px_28px_rgb(0_0_0/30%)]">
        <div className="mb-5 grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="text-[28px] font-bold leading-none text-white">
              {account.invitedCount}
            </p>
            <p className="mt-2 text-xs text-[#a1a1aa]">Приглашено</p>
          </div>
          <div className="text-center">
            <p className="text-[28px] font-bold leading-none text-white">
              {account.activeReferrals}
            </p>
            <p className="mt-2 text-xs text-[#a1a1aa]">Активны</p>
          </div>
          <div className="text-center">
            <p className="flex items-center justify-center gap-1 text-[28px] font-bold leading-none text-white">
              <span aria-hidden className="text-lg">
                🪙
              </span>
              {formatBalance(account.referralEarnings)}
            </p>
            <p className="mt-2 text-xs text-[#a1a1aa]">Заработано</p>
          </div>
        </div>

        <div className="mb-5">
          <ReferralProgress
            current={progressCurrent}
            required={progressTarget}
            label="До реферального кейса"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleShare}
            disabled={isSharing || !referralLink}
            className="flex h-12 flex-1 items-center justify-center rounded-full bg-[#9d59ff] text-sm font-bold text-white shadow-[0_0_24px_rgb(157_89_255/55%)] transition hover:opacity-95 disabled:opacity-60"
          >
            {isSharing ? '...' : 'Поделиться'}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex size-12 shrink-0 items-center justify-center rounded-[16px] border border-white/10 bg-[#1c1826] text-white transition hover:bg-white/10"
            aria-label="Скопировать"
          >
            <Copy size={18} aria-hidden />
          </button>
        </div>
      </section>

      <section className="rounded-[20px] border border-white/8 bg-[#16121f]/95 px-4 py-3.5">
        <p className="text-xs font-medium text-[#a1a1aa]">Твоя ссылка</p>
        <p className="mt-1.5 break-all text-sm leading-snug text-white">
          {referralLink || 'Открой приложение в Telegram'}
        </p>
      </section>
    </div>
  )
}
