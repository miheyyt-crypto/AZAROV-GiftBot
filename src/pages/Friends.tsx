import { useState } from 'react'

import { CoinBalance } from '@/components/BalanceCard'
import { CaseModal } from '@/components/CaseModal'
import { ReferralCaseBanner } from '@/components/ReferralCaseBanner'
import { ReferralHowItWorks } from '@/components/ReferralHowItWorks'
import { ReferralInviteCard } from '@/components/ReferralInviteCard'
import { ReferralStatsStrip } from '@/components/ReferralStatsStrip'
import { getCaseById } from '@/data/cases'
import { useBalance } from '@/hooks/useBalance'
import { useUserAccount } from '@/hooks/useUserAccount'
import { getReferralCaseStats } from '@/lib/referral'

export function Friends() {
  const account = useUserAccount()
  const { amount } = useBalance()
  const referralStats = getReferralCaseStats(account)
  const referralCase = getCaseById('referral')
  const [showReferralCase, setShowReferralCase] = useState(false)

  return (
    <div className="friends-page ui-page">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-[28px] font-bold tracking-tight text-white">Рефералы</h1>
        <CoinBalance />
      </header>

      <div className="flex flex-col gap-4">
        {referralCase ? (
          <ReferralCaseBanner onClick={() => setShowReferralCase(true)} />
        ) : null}
        <ReferralStatsStrip account={account} />
        <ReferralInviteCard account={account} />
        <ReferralHowItWorks />
      </div>

      {showReferralCase && referralCase ? (
        <CaseModal
          giftCase={referralCase}
          balance={amount}
          availableReferralCases={referralStats.availableReferralCases}
          onClose={() => setShowReferralCase(false)}
        />
      ) : null}
    </div>
  )
}
