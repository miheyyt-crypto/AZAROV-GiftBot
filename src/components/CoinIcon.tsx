import coinsImage from '@/assets/cases/reward-coins.png'

interface CoinIconProps {
  className?: string
  /** Decorative by default (aria-hidden). Pass alt text only if the icon is meaningful alone. */
  alt?: string
}

/** Official bot currency mark — transparent PNG coin art. */
export function CoinIcon({ className = 'size-[1.15rem]', alt = '' }: CoinIconProps) {
  return (
    <img
      src={coinsImage}
      alt={alt}
      className={['inline-block shrink-0 object-contain align-middle', className].filter(Boolean).join(' ')}
      draggable={false}
      aria-hidden={alt ? undefined : true}
    />
  )
}
