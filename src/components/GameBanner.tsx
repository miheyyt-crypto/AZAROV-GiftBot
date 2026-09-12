import { DeferredImage } from '@/components/DeferredImage'

type GameBannerProps = {
  ariaLabel: string
  onClick: () => void
  /** Optional cover image — leave unset for an empty placeholder square. */
  image?: string
  className?: string
  imageEager?: boolean
}

export function GameBanner({
  ariaLabel,
  onClick,
  image,
  className = '',
  imageEager = false,
}: GameBannerProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={[
        'game-banner relative aspect-square w-full min-w-0 overflow-hidden rounded-[20px]',
        'border border-white/10 bg-[#121018]',
        'shadow-[0_8px_20px_rgb(0_0_0/35%)]',
        'transition-transform duration-150 ease-out active:scale-[0.97]',
        className,
      ].join(' ')}
    >
      {image ? (
        <DeferredImage
          src={image}
          alt=""
          aria-hidden="true"
          eager={imageEager}
          className="size-full object-cover"
        />
      ) : null}
    </button>
  )
}
