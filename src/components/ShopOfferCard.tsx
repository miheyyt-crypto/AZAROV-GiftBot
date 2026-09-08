import type { ReactNode } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import type { ShopCardTheme } from '@/lib/shop-card-theme'

interface ShopOfferCardProps {
  theme: ShopCardTheme
  image: string
  imageClassName?: string
  title: string
  badge?: ReactNode
  footer: ReactNode
  onClick: () => void
}

export function ShopOfferCard({
  theme,
  image,
  imageClassName,
  title,
  badge,
  footer,
  onClick,
}: ShopOfferCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex h-full w-full flex-col overflow-hidden rounded-[22px] border bg-[#14101c]/90 text-left',
        theme.border,
        theme.glow,
      ].join(' ')}
    >
      <div className="relative aspect-[1.05] overflow-hidden">
        <div className={['absolute inset-0', theme.radial].join(' ')} aria-hidden />
        <img
          src={image}
          alt=""
          className={[
            'relative z-[1] size-full object-contain p-3 drop-shadow-[0_8px_18px_rgb(0_0_0/35%)]',
            imageClassName,
          ]
            .filter(Boolean)
            .join(' ')}
        />
        {badge}
      </div>

      <div className="flex flex-1 flex-col px-3 pb-3 pt-1">
        <h3 className="line-clamp-3 min-h-[3.25em] text-center text-[13px] font-semibold leading-snug text-white">
          {title}
        </h3>
        <div className="mt-auto pt-2.5">{footer}</div>
      </div>
    </button>
  )
}

export function ShopPriceButton({
  buttonClass,
  children,
}: {
  buttonClass: string
  children: ReactNode
}) {
  return (
    <span
      className={[
        'inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5',
        'text-sm font-bold text-white',
        buttonClass,
      ].join(' ')}
    >
      {children}
    </span>
  )
}

export function ShopCoinIcon({ className = 'size-[1.15rem]' }: { className?: string }) {
  return <CoinIcon className={className} />
}
