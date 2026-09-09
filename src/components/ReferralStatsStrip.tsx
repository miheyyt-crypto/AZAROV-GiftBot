import { Users } from 'lucide-react'

import { CoinIcon } from '@/components/CoinIcon'
import { ReferralProgress } from '@/components/ReferralProgress'
import { formatBalance } from '@/lib/balance'
import { getReferralCaseStats } from '@/lib/referral'
import type { UserAccount } from '@/types/account'

interface ReferralStatsStripProps {
  account: UserAccount
}

export function ReferralStatsStrip({ account }: ReferralStatsStripProps) {
  const caseStats = getReferralCaseStats(account)

  return (
    <section className="friends-panel overflow-hidden rounded-[24px] border border-[rgb(139_61_255/28%)] bg-[linear-gradient(165deg,#15101f_0%,#100c18_55%,#0d0a14_100%)] p-4 shadow-[0_0_28px_rgb(139_61_255/14%),0_10px_28px_rgb(0_0_0/35%)]">
      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-[16px] border border-white/[0.06] bg-black/25 px-2 py-3 text-center">
          <p className="text-[22px] font-bold leading-none text-white tabular-nums">
            {account.invitedCount}
          </p>
          <p className="mt-1.5 text-[11px] text-[#9b96ab]">Приглашено</p>
        </div>
        <div className="rounded-[16px] border border-white/[0.06] bg-black/25 px-2 py-3 text-center">
          <p className="text-[22px] font-bold leading-none text-white tabular-nums">
            {account.activeReferrals}
          </p>
          <p className="mt-1.5 text-[11px] text-[#9b96ab]">Активны</p>
        </div>
        <div className="rounded-[16px] border border-white/[0.06] bg-black/25 px-2 py-3 text-center">
          <p className="flex items-center justify-center gap-1 text-[22px] font-bold leading-none text-white tabular-nums">
            <CoinIcon className="size-5" />
            {formatBalance(account.referralEarnings)}
          </p>
          <p className="mt-1.5 text-[11px] text-[#9b96ab]">Заработано</p>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-xl bg-[rgb(139_61_255/22%)] text-neon-purple">
          <Users size={16} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Ваши рефералы</p>
          <p className="text-[11px] text-[#9b96ab]">
            Активные: {account.activeReferrals}
            {caseStats.availableReferralCases > 0
              ? ` · кейсов доступно: ${caseStats.availableReferralCases}`
              : ''}
          </p>
        </div>
      </div>

      <ReferralProgress
        current={caseStats.currentProgress}
        required={caseStats.progressTarget}
        label="До реферального кейса"
      />
    </section>
  )
}
