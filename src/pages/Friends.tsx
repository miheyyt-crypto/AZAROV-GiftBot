import { CoinBalance } from '@/components/BalanceCard'
import { ReferralHowItWorks } from '@/components/ReferralHowItWorks'
import { ReferralInviteCard } from '@/components/ReferralInviteCard'
import { useUserAccount } from '@/hooks/useUserAccount'

export function Friends() {
  const account = useUserAccount()

  return (
    <div className="ui-page">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">Друзья</h1>
        <CoinBalance />
      </header>

      <p className="mb-5 text-sm leading-relaxed text-text-secondary">
        За каждого друга, который привяжет Kick по твоей ссылке — по 500 монет обоим.
      </p>

      <div className="space-y-3.5">
        <ReferralInviteCard account={account} />
        <ReferralHowItWorks />
      </div>
    </div>
  )
}
