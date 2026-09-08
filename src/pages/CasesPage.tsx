import { useMemo, useState } from 'react'

import { CaseCard } from '@/components/CaseCard'
import { CaseModal } from '@/components/CaseModal'
import { getCases } from '@/data/cases'
import { useBalance } from '@/hooks/useBalance'
import { useUserAccount } from '@/hooks/useUserAccount'
import { getReferralCaseStats } from '@/lib/referral'
import type { GiftCase } from '@/types/case'

export function CasesPage() {
  const account = useUserAccount()
  const { amount } = useBalance()
  const giftCases = useMemo(() => getCases(), [])
  const [activeCase, setActiveCase] = useState<GiftCase | null>(null)
  const referralStats = getReferralCaseStats(account)

  return (
    <>
      <div className="grid grid-cols-2 items-stretch gap-3.5">
        {giftCases.map((giftCase) => (
          <CaseCard
            key={giftCase.id}
            giftCase={giftCase}
            availableReferralCases={referralStats.availableReferralCases}
            remainingInvites={referralStats.remainingInvites}
            onOpen={setActiveCase}
          />
        ))}
      </div>

      {activeCase && (
        <CaseModal
          giftCase={activeCase}
          balance={amount}
          availableReferralCases={referralStats.availableReferralCases}
          onClose={() => setActiveCase(null)}
        />
      )}
    </>
  )
}
