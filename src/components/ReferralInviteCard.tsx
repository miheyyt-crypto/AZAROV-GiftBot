import { Copy, Gift, Link2, Send } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import { useNotifications } from '@/components/NotificationProvider'
import { applyAccountSnapshot } from '@/lib/account'
import { getReferralMe } from '@/lib/api'
import { hydrateBalanceFromAccount } from '@/lib/balance'
import {
  REFERRAL_ACTIVATION_REWARD,
  REFERRAL_CASE_EVERY,
} from '@/lib/constants'
import {
  buildReferralLink,
  copyText,
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
  const [copiedPulse, setCopiedPulse] = useState(false)
  const [serverMe, setServerMe] = useState<ServerReferralMe | null>(null)
  const referralLink =
    serverMe?.referralLink || account.referralLink || buildReferralLink(account.referralCode)

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
    setCopiedPulse(true)
    window.setTimeout(() => setCopiedPulse(false), 900)
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
    <section className="friends-panel relative overflow-hidden rounded-[26px] border border-[rgb(139_61_255/32%)] bg-[linear-gradient(165deg,#171221_0%,#120e1c_48%,#0e0b16_100%)] p-4 shadow-[0_0_36px_rgb(139_61_255/18%),0_12px_32px_rgb(0_0_0/40%)] sm:p-5">
      <div
        className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-[rgb(139_61_255/18%)] blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-16 -left-8 size-44 rounded-full bg-[rgb(33_150_255/10%)] blur-3xl"
        aria-hidden
      />

      <div className="relative z-10">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(145deg,#9b4dff,#6d28d9)] text-white shadow-[0_0_20px_rgb(139_61_255/45%)]">
            <Link2 size={20} aria-hidden />
          </span>
          <h2 className="text-lg font-bold tracking-tight text-white">Реферальная ссылка</h2>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-[18px] border border-[rgb(0_200_83/22%)] bg-[linear-gradient(160deg,rgb(0_200_83/10%),rgb(0_0_0/25%))] p-3 shadow-[0_0_18px_rgb(0_200_83/10%)]">
            <div className="mb-2.5 flex size-10 items-center justify-center rounded-full bg-[rgb(0_200_83/18%)] shadow-[0_0_16px_rgb(0_200_83/35%)]">
              <CoinIcon className="size-5" />
            </div>
            <p className="text-[11px] font-medium text-[#9b96ab]">За приглашение</p>
            <p className="mt-1 text-[15px] font-bold leading-snug text-white">
              {REFERRAL_ACTIVATION_REWARD.toLocaleString('ru-RU')}{' '}
              <span className="font-semibold text-white/85">монет</span>
            </p>
            <p className="mt-0.5 text-[11px] text-[#8f8a9e]">после привязки Kick</p>
          </div>

          <div className="rounded-[18px] border border-[rgb(139_61_255/28%)] bg-[linear-gradient(160deg,rgb(139_61_255/12%),rgb(0_0_0/25%))] p-3 shadow-[0_0_18px_rgb(139_61_255/12%)]">
            <div className="mb-2.5 flex size-10 items-center justify-center rounded-full bg-[rgb(139_61_255/20%)] text-neon-purple shadow-[0_0_16px_rgb(139_61_255/40%)]">
              <Gift size={18} aria-hidden />
            </div>
            <p className="text-[11px] font-medium text-[#9b96ab]">За активного друга</p>
            <p className="mt-1 text-[15px] font-bold leading-snug text-white">реф-кейс</p>
            <p className="mt-0.5 text-[11px] text-[#8f8a9e]">
              каждые {REFERRAL_CASE_EVERY} друзей
            </p>
          </div>
        </div>

        <div className="mb-3.5 flex min-h-12 items-center gap-2 rounded-[16px] border border-[rgb(139_61_255/35%)] bg-[#0c0914] py-1.5 pl-3 pr-1.5 shadow-[inset_0_0_0_1px_rgb(139_61_255/8%)]">
          <Link2 size={16} className="shrink-0 text-neon-purple" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#d4b8ff]">
            {referralLink || 'Открой приложение в Telegram'}
          </p>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className={[
              'friends-press flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-[rgb(139_61_255/40%)] bg-[rgb(139_61_255/22%)] text-white transition duration-200',
              'hover:bg-[rgb(139_61_255/35%)] hover:shadow-[0_0_16px_rgb(139_61_255/35%)]',
              'active:scale-[0.96]',
              copiedPulse ? 'shadow-[0_0_18px_rgb(139_61_255/55%)]' : '',
            ].join(' ')}
            aria-label="Скопировать ссылку"
          >
            <Copy size={17} aria-hidden />
          </button>
        </div>

        <button
          type="button"
          onClick={() => void handleShare()}
          disabled={isSharing || !referralLink}
          className={[
            'friends-cta friends-press relative flex min-h-[54px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-[18px]',
            'bg-[linear-gradient(90deg,#20BFFF_0%,#2196FF_55%,#1E88E5_100%)]',
            'text-[15px] font-bold tracking-tight text-white',
            'shadow-[0_0_28px_rgb(33_150_255/45%),0_8px_20px_rgb(0_100_255/25%)]',
            'transition duration-200 hover:brightness-110 active:scale-[0.98] active:brightness-95',
            'disabled:cursor-not-allowed disabled:opacity-60',
          ].join(' ')}
        >
          <Send size={18} aria-hidden />
          {isSharing ? 'Открываем…' : 'Пригласить друга в Telegram'}
        </button>

        <p className="mt-3 text-center text-[11px] leading-relaxed text-[#b8a070]">
          <span className="font-semibold text-[#ffb020]">Важно:</span> у друга должен быть Telegram{' '}
          <span className="font-semibold text-[#ffb020]">@username</span>, иначе приглашение не
          засчитается.
        </p>
      </div>
    </section>
  )
}
