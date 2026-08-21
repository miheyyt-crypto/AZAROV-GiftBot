import { CoinBalance } from '@/components/BalanceCard'
import { ReferralHowItWorks } from '@/components/ReferralHowItWorks'
import { ReferralInviteCard } from '@/components/ReferralInviteCard'
import { useUserAccount } from '@/hooks/useUserAccount'

export function Friends() {
  const account = useUserAccount()

  return (
    <div
      className="min-h-full overflow-x-hidden bg-bg-dark px-4 pb-6"
      style={{
        paddingTop: 'calc(1rem + var(--safe-area-top))',
        backgroundImage:
          'radial-gradient(ellipse 90% 45% at 50% -5%, rgb(124 58 237 / 22%), transparent 60%)',
      }}
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">Друзья</h1>
        <CoinBalance />
      </header>

      <p className="mb-5 text-sm leading-relaxed text-[#a1a1aa]">
        За каждого друга, который дойдёт до первого бонуса — монеты обоим.
      </p>

      <div className="space-y-3.5">
        <ReferralInviteCard account={account} />
        <ReferralHowItWorks />
      </div>
    </div>
  )
}
