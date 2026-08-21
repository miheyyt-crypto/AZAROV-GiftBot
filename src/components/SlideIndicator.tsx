interface SlideIndicatorProps {
  count: number
  activeIndex: number
}

export function SlideIndicator({ count, activeIndex }: SlideIndicatorProps) {
  return (
    <div
      className="flex items-center justify-center gap-2"
      role="tablist"
      aria-label="Индикатор слайдов"
    >
      {Array.from({ length: count }, (_, index) => {
        const isActive = index === activeIndex

        return (
          <span
            key={index}
            role="tab"
            aria-selected={isActive}
            aria-label={`Слайд ${index + 1}`}
            className={[
              'rounded-full transition-all duration-300',
              isActive
                ? 'h-2 w-6 bg-neon-purple shadow-[var(--glow-purple)]'
                : 'size-2 bg-white/25',
            ].join(' ')}
          />
        )
      })}
    </div>
  )
}
