import { Lock } from 'lucide-react'

import { ShopCoinIcon, ShopOfferCard, ShopPriceButton } from '@/components/ShopOfferCard'
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

  return (
    <ShopOfferCard
      theme={theme}
      image={giftCase.image}
      imageClassName="scale-[0.92]"
      title={giftCase.name}
      onClick={() => onOpen(giftCase)}
      badge={
        badge ? (
          <span className="absolute left-1/2 top-2 z-[2] -translate-x-1/2 rounded-full border border-white/10 bg-black/55 px-2.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white/90 backdrop-blur-sm">
            {badge}
          </span>
        ) : undefined
      }
      footer={
        isReferral ? (
          canOpenReferral ? (
            <ShopPriceButton buttonClass={theme.button}>
              Открыть
              {availableReferralCases > 1 ? ` · ${availableReferralCases}` : ''}
            </ShopPriceButton>
          ) : (
            <div className="flex min-h-[42px] flex-col items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-center">
              <Lock size={14} className="text-muted" aria-hidden />
              <span className="text-[11px] leading-snug font-medium text-muted">
                {getReferralCaseRemainingLabel(remainingInvites)}
              </span>
            </div>
          )
        ) : (
          <ShopPriceButton buttonClass={theme.button}>
            <ShopCoinIcon />
            {formatBalance(giftCase.price ?? 0)}
          </ShopPriceButton>
        )
      }
    />
  )
}
