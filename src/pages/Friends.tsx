import { CoinBalance } from '@/components/BalanceCard'
import { ReferralHowItWorks } from '@/components/ReferralHowItWorks'
import { ReferralInviteCard } from '@/components/ReferralInviteCard'
import { ReferralStatsStrip } from '@/components/ReferralStatsStrip'
import { useUserAccount } from '@/hooks/useUserAccount'

export function Friends() {
  const account = useUserAccount()

  return (
    <div className="friends-page ui-page">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-[28px] font-bold tracking-tight text-white">Рефералы</h1>
        <CoinBalance />
      </header>

      <div className="flex flex-col gap-4">
        <ReferralStatsStrip account={account} />
        <ReferralInviteCard account={account} />
        <ReferralHowItWorks />
      </div>
    </div>
  )
}
