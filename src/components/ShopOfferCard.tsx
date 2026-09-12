import type { ReactNode } from 'react'

import { CoinIcon } from '@/components/CoinIcon'
import { DeferredImage } from '@/components/DeferredImage'
import type { ShopCardTheme } from '@/lib/shop-card-theme'

interface ShopOfferCardProps {
  theme: ShopCardTheme
  image: string
  imageClassName?: string
  title: string
  badge?: ReactNode
  footer: ReactNode
  onClick: () => void
  /** First row of products can load immediately. */
  imageEager?: boolean
}

export function ShopOfferCard({
  theme,
  image,
  imageClassName,
  title,
  badge,
  footer,
  onClick,
  imageEager = false,
}: ShopOfferCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex h-full w-full flex-col overflow-hidden rounded-[20px] border bg-bg-surface/95 text-left',
        theme.border,
        theme.glow,
      ].join(' ')}
    >
      <div className="relative aspect-[1.05] overflow-hidden bg-black/20">
        <div className={['absolute inset-0', theme.radial].join(' ')} aria-hidden />
        <DeferredImage
          src={image}
          alt=""
          eager={imageEager}
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
        <h3 className="line-clamp-3 min-h-[3.25em] text-center text-sm font-semibold leading-snug tracking-tight text-white">
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
        'inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5',
        'text-sm font-semibold text-white',
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
