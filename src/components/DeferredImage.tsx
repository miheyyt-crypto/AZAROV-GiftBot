import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'

import { tabPerfImageEvent } from '@/lib/tab-perf'

type DeferredImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string
  /** Load immediately (above-fold). Default: wait until near viewport. */
  eager?: boolean
  /** Extra rootMargin for IntersectionObserver. */
  rootMargin?: string
}

/**
 * Does not set img.src until the element is near the viewport (unless eager).
 * Parent should reserve size (aspect-ratio) to avoid layout shift.
 */
export function DeferredImage({
  src,
  eager = false,
  rootMargin = '160px 0px',
  alt = '',
  className,
  onLoad,
  onError,
  ...rest
}: DeferredImageProps) {
  const ref = useRef<HTMLImageElement | null>(null)
  const [live, setLive] = useState(eager)
  const loggedRef = useRef(false)

  useEffect(() => {
    if (eager || live) {
      return
    }
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setLive(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setLive(true)
          io.disconnect()
        }
      },
      { root: null, rootMargin, threshold: 0.01 },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [eager, live, rootMargin])

  useEffect(() => {
    if (!live || loggedRef.current) {
      return
    }
    loggedRef.current = true
    tabPerfImageEvent('image request', { src: src.slice(-48) })
  }, [live, src])

  return (
    <img
      ref={ref}
      src={live ? src : undefined}
      alt={alt}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onLoad={(e) => {
        tabPerfImageEvent('image loaded', { src: src.slice(-48) })
        onLoad?.(e)
      }}
      onError={onError}
      {...rest}
    />
  )
}
