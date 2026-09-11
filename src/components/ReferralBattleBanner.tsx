import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CoinIcon } from '@/components/CoinIcon'
import { useReferralContestVisibility } from '@/hooks/useReferralContestAccess'
import { ROUTES } from '@/lib/constants'
import { formatCoinsAmount, formatContestCountdown } from '@/lib/referral-contest'

export function ReferralBattleBanner() {
  const navigate = useNavigate()
  const visibility = useReferralContestVisibility()
  const [countdown, setCountdown] = useState(() =>
    visibility?.endsAt ? formatContestCountdown(visibility.endsAt) : '',
  )

  useEffect(() => {
    if (!visibility?.visible || !visibility.endsAt || visibility.status === 'ended') {
      return
    }
    const tick = () => setCountdown(formatContestCountdown(visibility.endsAt))
    tick()
    const id = window.setInterval(tick, 30_000)
    return () => window.clearInterval(id)
  }, [visibility?.endsAt, visibility?.status, visibility?.visible])

  if (!visibility?.visible) {
    return null
  }

  const ended = visibility.status === 'ended'
  const cta = ended ? 'СМОТРЕТЬ РЕЙТИНГ' : 'УЧАСТВОВАТЬ'
  const prizePool = formatCoinsAmount(visibility.prizePool)

  return (
    <button
      type="button"
      onClick={() => navigate(ROUTES.referralBattle)}
      className={[
        'interactive referral-battle-banner relative w-full overflow-hidden rounded-[24px] border p-5 text-left',
        'border-[rgb(244_201_93/35%)]',
        'bg-[linear-gradient(135deg,#2a1a08_0%,#1a1220_42%,#0f1420_100%)]',
        'shadow-[0_0_40px_rgb(244_201_93/18%),0_12px_28px_rgb(0_0_0/45%)]',
      ].join(' ')}
    >
      <div
        className="pointer-events-none absolute -left-10 -top-12 size-44 rounded-full bg-[rgb(244_201_93/20%)] blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-16 -right-8 size-48 rounded-full bg-[rgb(139_92_246/22%)] blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgb(244_201_93/70%)] to-transparent"
        aria-hidden
      />

      <div className="relative z-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(244_201_93/85%)]">
          Event
        </p>
        <h3 className="mt-1 text-[1.35rem] font-black leading-tight tracking-tight text-white sm:text-2xl">
          🏆 РЕФЕРАЛЬНЫЙ БАТТЛ
        </h3>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm font-semibold text-white/90">
          <span className="inline-flex items-center gap-1 text-gold-bright">
            <CoinIcon className="size-4" />
            {prizePool}
          </span>
          <span className="text-white/60">ПРИЗОВОГО ФОНДА</span>
        </p>

        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full border border-[rgb(245_200_66/35%)] bg-[rgb(245_200_66/12%)] px-2.5 py-1 text-[#f5c842]">
            🥇 25 000
          </span>
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[#c8d0dc]">
            🥈 17 000
          </span>
          <span className="rounded-full border border-[rgb(212_132_90/35%)] bg-[rgb(212_132_90/12%)] px-2.5 py-1 text-[#e8a06a]">
            🥉 15 000
          </span>
        </div>

        {!ended && countdown ? (
          <p className="mt-3 text-xs text-white/55">⏱ До окончания: {countdown}</p>
        ) : null}
        {ended ? <p className="mt-3 text-xs font-medium text-gold">🏆 Конкурс завершён</p> : null}

        <div className="mt-4 inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-[#f4c95d] to-[#e8a84a] px-3.5 py-2 text-sm font-bold text-[#1a1200]">
          {cta}
          <ChevronRight size={16} aria-hidden />
        </div>
      </div>
    </button>
  )
}
