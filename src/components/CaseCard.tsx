import { Lock } from 'lucide-react'

import { ShopCoinIcon } from '@/components/ShopOfferCard'
import { formatBalance } from '@/lib/balance'
import { getReferralCaseRemainingLabel } from '@/lib/referral'
import { getCaseCardTheme } from '@/lib/shop-card-theme'
import type { GiftCase } from '@/types/case'

interface CaseCardProps {
  giftCase: GiftCase
  availableReferralCases?: number
  remainingInvites?: number
  onOpen: (giftCase: GiftCase) => void
}

export function CaseCard({
  giftCase,
  availableReferralCases = 0,
  remainingInvites = 5,
  onOpen,
}: CaseCardProps) {
  const theme = getCaseCardTheme(giftCase.id)
  const isReferral = giftCase.type === 'referral'
  const canOpenReferral = isReferral && availableReferralCases > 0
  const badge = isReferral ? giftCase.subtitle : giftCase.maxPrize
  const accent = theme.accentText || 'text-white'

  return (
    <article
      className={[
        'flex h-full w-full flex-col overflow-hidden rounded-[22px] border bg-[#14101c]/90',
        theme.border,
        theme.glow,
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => onOpen(giftCase)}
        className="relative aspect-[1.05] w-full overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-purple"
        aria-label={giftCase.name}
      >
        <div className={['absolute inset-0', theme.radial].join(' ')} aria-hidden />
        <img
          src={giftCase.image}
          alt=""
          className={[
            'relative z-[1] size-full drop-shadow-[0_8px_18px_rgb(0_0_0/35%)]',
            isReferral
              ? 'object-cover object-center scale-[1.12]'
              : 'object-contain scale-[1.08] p-1.5',
          ].join(' ')}
          draggable={false}
        />
        {/* Soft haze so art fades into the card body instead of a hard cut */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[42%] bg-gradient-to-b from-transparent via-[#14101c]/55 to-[#14101c]"
          aria-hidden
        />
        {badge ? (
          <span
            className={[
              'absolute left-1/2 top-2 z-[3] -translate-x-1/2 rounded-full border border-white/10 bg-black/55 px-2.5 py-0.5 text-[10px] font-semibold whitespace-nowrap backdrop-blur-sm',
              accent,
            ].join(' ')}
          >
            {badge}
          </span>
        ) : null}
      </button>

      <div className="relative z-[1] -mt-5 flex flex-1 flex-col px-3 pb-3 pt-0">
        <h3 className="line-clamp-2 min-h-[2.5em] text-center text-[13px] font-semibold leading-snug text-white">
          {giftCase.name}
        </h3>

        <div className="mt-auto flex flex-col gap-2 pt-2.5">
          {isReferral ? (
            canOpenReferral ? (
              <button
                type="button"
                onClick={() => onOpen(giftCase)}
                className={[
                  'inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm font-bold',
                  accent,
                ].join(' ')}
              >
                Открыть
                {availableReferralCases > 1 ? ` · ${availableReferralCases}` : ''}
              </button>
            ) : (
              <div className="flex min-h-[42px] flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/[0.06] px-2 py-2 text-center">
                <Lock size={14} className="text-muted" aria-hidden />
                <span className="text-[11px] leading-snug font-medium text-muted">
                  {getReferralCaseRemainingLabel(remainingInvites)}
                </span>
              </div>
            )
          ) : (
            <button
              type="button"
              onClick={() => onOpen(giftCase)}
              className={[
                'inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm font-bold',
                accent,
              ].join(' ')}
            >
              <ShopCoinIcon />
              {formatBalance(giftCase.price ?? 0)}
            </button>
          )}

          <button
            type="button"
            onClick={() => onOpen(giftCase)}
            className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm font-semibold text-white"
          >
            Что внутри
          </button>
        </div>
      </div>
    </article>
  )
}
