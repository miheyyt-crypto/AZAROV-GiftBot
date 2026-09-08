interface SlideIndicatorProps {
  count: number
  activeIndex: number
}

export function SlideIndicator({ count, activeIndex }: SlideIndicatorProps) {
  return (
    <div
      className="flex items-center justify-center gap-1.5"
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
              isActive ? 'h-1 w-5 bg-white/85' : 'h-1 w-1.5 bg-white/25',
            ].join(' ')}
          />
        )
      })}
    </div>
  )
}
