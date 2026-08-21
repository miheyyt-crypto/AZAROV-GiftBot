import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { SlideIndicator } from '@/components/SlideIndicator'
import { HOME_BANNER_AUTOPLAY_MS } from '@/lib/constants'
import type { HomeBanner } from '@/types/banner'

const SWIPE_THRESHOLD = 50
const DIRECTION_LOCK_PX = 8

interface HomeBannerSliderProps {
  banners: HomeBanner[]
}

export function HomeBannerSlider({ banners }: HomeBannerSliderProps) {
  const navigate = useNavigate()
  const slideCount = banners.length
  const [trackIndex, setTrackIndex] = useState(slideCount > 1 ? 1 : 0)
  const [enableTransition, setEnableTransition] = useState(true)
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  const pointerId = useRef<number | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const deltaX = useRef(0)
  const deltaY = useRef(0)
  const directionLock = useRef<'h' | 'v' | null>(null)
  const suppressClick = useRef(false)
  const jumping = useRef(false)
  const autoplayTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const slides = useMemo(() => {
    if (slideCount <= 1) {
      return banners
    }

    return [banners[slideCount - 1], ...banners, banners[0]]
  }, [banners, slideCount])

  const activeIndex = useMemo(() => {
    if (slideCount <= 1) {
      return 0
    }

    if (trackIndex === 0) {
      return slideCount - 1
    }

    if (trackIndex === slideCount + 1) {
      return 0
    }

    return trackIndex - 1
  }, [slideCount, trackIndex])

  const stopAutoplay = useCallback(() => {
    if (autoplayTimer.current) {
      clearInterval(autoplayTimer.current)
      autoplayTimer.current = null
    }
  }, [])

  const resetAutoplay = useCallback(() => {
    stopAutoplay()

    if (slideCount <= 1) {
      return
    }

    autoplayTimer.current = setInterval(() => {
      setEnableTransition(true)
      setTrackIndex((current) => current + 1)
    }, HOME_BANNER_AUTOPLAY_MS)
  }, [slideCount, stopAutoplay])

  useEffect(() => {
    resetAutoplay()

    return () => {
      stopAutoplay()
    }
  }, [resetAutoplay, stopAutoplay])

  useLayoutEffect(() => {
    if (!jumping.current) {
      return
    }

    jumping.current = false
    const frame = window.requestAnimationFrame(() => {
      setEnableTransition(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [trackIndex])

  function goNext() {
    setEnableTransition(true)
    setTrackIndex((current) => current + 1)
  }

  function goPrev() {
    setEnableTransition(true)
    setTrackIndex((current) => current - 1)
  }

  function onTransitionEnd() {
    if (slideCount <= 1) {
      return
    }

    if (trackIndex === 0) {
      jumping.current = true
      setEnableTransition(false)
      setTrackIndex(slideCount)
      return
    }

    if (trackIndex === slideCount + 1) {
      jumping.current = true
      setEnableTransition(false)
      setTrackIndex(1)
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== null || slideCount <= 1) {
      return
    }

    pointerId.current = event.pointerId
    startX.current = event.clientX
    startY.current = event.clientY
    deltaX.current = 0
    deltaY.current = 0
    directionLock.current = null
    suppressClick.current = false
    stopAutoplay()
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId) {
      return
    }

    deltaX.current = event.clientX - startX.current
    deltaY.current = event.clientY - startY.current

    if (!directionLock.current) {
      if (
        Math.abs(deltaX.current) < DIRECTION_LOCK_PX &&
        Math.abs(deltaY.current) < DIRECTION_LOCK_PX
      ) {
        return
      }

      directionLock.current =
        Math.abs(deltaX.current) > Math.abs(deltaY.current) ? 'h' : 'v'

      if (directionLock.current === 'h') {
        setIsDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    }

    if (directionLock.current === 'h') {
      event.preventDefault()
      setDragX(deltaX.current)
    }
  }

  function finishPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId) {
      return
    }

    const horizontal = directionLock.current === 'h'
    const swiped = horizontal && Math.abs(deltaX.current) >= SWIPE_THRESHOLD

    if (horizontal && Math.abs(deltaX.current) > DIRECTION_LOCK_PX) {
      suppressClick.current = true
    }

    if (swiped) {
      if (deltaX.current < 0) {
        goNext()
      } else {
        goPrev()
      }
    }

    pointerId.current = null
    directionLock.current = null
    deltaX.current = 0
    deltaY.current = 0
    setDragX(0)
    setIsDragging(false)
    resetAutoplay()
  }

  function onBannerClick(event: React.MouseEvent<HTMLButtonElement>, targetTab: string) {
    if (suppressClick.current) {
      event.preventDefault()
      event.stopPropagation()
      suppressClick.current = false
      return
    }

    navigate(targetTab)
  }

  if (slideCount === 0) {
    return null
  }

  return (
    <section className="mb-4 w-full overflow-x-hidden">
      <div
        className="relative w-full touch-pan-y overflow-hidden rounded-[22px] select-none shadow-[0_0_28px_rgb(168_85_247/18%)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <div
          className={['flex', isDragging || !enableTransition ? 'transition-none' : 'transition-transform duration-500 ease-out'].join(
            ' ',
          )}
          style={{
            transform: `translateX(calc(-${trackIndex * 100}% + ${dragX}px))`,
          }}
          onTransitionEnd={onTransitionEnd}
        >
          {slides.map((banner, index) => (
            <button
              key={`${banner.id}-${index}`}
              type="button"
              onClick={(event) => onBannerClick(event, banner.targetTab)}
              className="aspect-[2.1/1] w-full shrink-0 overflow-hidden rounded-[22px] border border-neon-purple/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-purple"
              aria-label={`Перейти на вкладку ${banner.targetTab}`}
            >
              <img
                src={banner.image}
                alt=""
                className="pointer-events-none size-full object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <SlideIndicator count={slideCount} activeIndex={activeIndex} />
      </div>
    </section>
  )
}
