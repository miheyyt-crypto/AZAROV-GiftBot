import { Lock } from 'lucide-react'
import type { CSSProperties } from 'react'

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

function splitPrizeBadge(text: string): { prefix: string | null; value: string } {
  const match = text.match(/^(до)\s+(.+)$/i)
  if (match) {
    return { prefix: match[1], value: match[2] }
  }
  return { prefix: null, value: text }
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
  const badgeText = isReferral ? giftCase.subtitle : giftCase.maxPrize
  const badgeParts = badgeText ? splitPrizeBadge(badgeText) : null

  const cardStyle = {
    '--case-rgb': theme.accentRgb,
    borderColor: 'rgb(var(--case-rgb) / 0.78)',
    boxShadow:
      '0 0 10px rgb(var(--case-rgb) / 0.35), 0 0 26px rgb(var(--case-rgb) / 0.18), inset 0 0 14px rgb(var(--case-rgb) / 0.1)',
  } as CSSProperties

  const open = () => onOpen(giftCase)

  return (
    <article
      className="group flex h-full w-full flex-col overflow-hidden rounded-[32px] border-2 bg-[#12101a]/95 transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:[box-shadow:0_0_14px_rgb(var(--case-rgb)/0.45),0_0_32px_rgb(var(--case-rgb)/0.25),inset_0_0_14px_rgb(var(--case-rgb)/0.12)] active:scale-[0.98]"
      style={cardStyle}
    >
      <div className="relative w-full shrink-0 pt-2">
        {giftCase.isNew ? (
          <span className="absolute top-3.5 left-2.5 z-[3] rounded-full bg-gradient-to-r from-[#ff4d78] to-[#ff2d55] px-3 py-1.5 text-[10px] font-extrabold tracking-wide text-white uppercase shadow-[0_0_14px_rgb(255_45_85/45%)]">
            NEW
          </span>
        ) : null}

        {badgeParts ? (
          <span
            className="absolute top-3.5 right-2.5 z-[3] inline-flex max-w-[78%] items-center truncate rounded-full border bg-black/60 px-3 py-1.5 text-[11px] font-extrabold backdrop-blur-sm"
            style={{
              borderColor: 'rgb(var(--case-rgb) / 0.55)',
              boxShadow: '0 0 12px rgb(var(--case-rgb) / 0.28)',
            }}
          >
            {badgeParts.prefix ? (
              <>
                <span className="mr-1 font-bold text-white/75">{badgeParts.prefix}</span>
                <span className={theme.accentText}>{badgeParts.value}</span>
              </>
            ) : (
              <span className={theme.accentText}>{badgeParts.value}</span>
            )}
          </span>
        ) : null}

        <button
          type="button"
          onClick={open}
          className="relative block aspect-[1.05] w-full overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-purple"
          aria-label={giftCase.name}
        >
          <div className={['absolute inset-0', theme.radial].join(' ')} aria-hidden />
          <img
            src={giftCase.image}
            alt=""
            className="relative z-[1] size-full object-contain object-center p-2 drop-shadow-[0_10px_22px_rgb(0_0_0/40%)]"
            style={{
              filter: `drop-shadow(0 0 18px rgb(${theme.accentRgb} / 0.28))`,
            }}
            draggable={false}
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[48%] bg-gradient-to-b from-transparent via-[#12101a]/50 to-[#12101a]"
            aria-hidden
          />
        </button>
      </div>

      <div className="relative z-[1] -mt-6 flex flex-1 flex-col items-center px-3 pb-3.5">
        <h3 className="mb-3 line-clamp-2 text-center text-[17px] leading-snug font-extrabold text-white drop-shadow-[0_2px_8px_rgb(0_0_0/55%)]">
          {giftCase.name}
        </h3>

        <div className="mt-auto flex w-full flex-col items-center gap-2.5">
          {isReferral ? (
            canOpenReferral ? (
              <button
                type="button"
                onClick={open}
                className={[
                  'inline-flex h-[52px] w-[90%] items-center justify-center gap-2 rounded-[22px] border bg-[rgba(30,30,40,0.72)] text-[17px] font-extrabold transition-transform duration-200 ease-out active:scale-[0.97]',
                  theme.accentText,
                ].join(' ')}
                style={{
                  borderColor: 'rgb(var(--case-rgb) / 0.55)',
                  boxShadow:
                    '0 0 12px rgb(var(--case-rgb) / 0.22), inset 0 0 10px rgb(var(--case-rgb) / 0.08)',
                }}
              >
                Открыть
                {availableReferralCases > 1 ? ` · ${availableReferralCases}` : ''}
              </button>
            ) : (
              <div
                className="flex min-h-[52px] w-[90%] flex-col items-center justify-center gap-1 rounded-[22px] border bg-[rgba(30,30,40,0.72)] px-2 py-2 text-center"
                style={{
                  borderColor: 'rgb(var(--case-rgb) / 0.35)',
                  boxShadow: 'inset 0 0 10px rgb(var(--case-rgb) / 0.06)',
                }}
              >
                <Lock size={14} className="text-muted" aria-hidden />
                <span className="text-[11px] leading-snug font-medium text-muted">
                  {getReferralCaseRemainingLabel(remainingInvites)}
                </span>
              </div>
            )
          ) : (
            <button
              type="button"
              onClick={open}
              className={[
                'inline-flex h-[52px] w-[90%] items-center justify-center gap-2 rounded-[22px] border bg-[rgba(30,30,40,0.72)] text-[18px] font-extrabold transition-transform duration-200 ease-out active:scale-[0.97]',
                theme.accentText,
              ].join(' ')}
              style={{
                borderColor: 'rgb(var(--case-rgb) / 0.55)',
                boxShadow:
                  '0 0 12px rgb(var(--case-rgb) / 0.22), inset 0 0 10px rgb(var(--case-rgb) / 0.08)',
              }}
            >
              <ShopCoinIcon className="size-[26px] text-[12px]" />
              {formatBalance(giftCase.price ?? 0)}
            </button>
          )}

          <button
            type="button"
            onClick={open}
            className="inline-flex h-[52px] w-[90%] items-center justify-center rounded-[22px] border border-[rgba(150,145,180,0.35)] bg-[rgba(70,68,90,0.65)] text-[16px] font-bold text-white transition-transform duration-200 ease-out active:scale-[0.97]"
          >
            Что внутри
          </button>
        </div>
      </div>
    </article>
  )
}
