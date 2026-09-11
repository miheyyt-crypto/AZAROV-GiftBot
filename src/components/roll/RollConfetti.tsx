import { useEffect, useMemo, useState } from 'react'

type RollConfettiProps = {
  active: boolean
  burstKey?: string | null
}

const COLORS = ['#ff6a2b', '#b39ddb', '#4fc3f7', '#66bb6a', '#ffca28', '#ef5350', '#ce93d8']

export function RollConfetti({ active, burstKey }: RollConfettiProps) {
  const [visible, setVisible] = useState(false)
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, index) => ({
        id: index,
        left: 8 + ((index * 17) % 84),
        delay: (index % 7) * 0.05,
        duration: 1.1 + (index % 5) * 0.12,
        color: COLORS[index % COLORS.length],
        rotate: (index * 47) % 360,
        size: 6 + (index % 4) * 2,
      })),
    [],
  )

  useEffect(() => {
    if (!active || !burstKey) {
      setVisible(false)
      return
    }
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 2200)
    return () => window.clearTimeout(timer)
  }, [active, burstKey])

  if (!visible) {
    return null
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden>
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="roll-confetti-piece absolute top-0 rounded-[2px]"
          style={{
            left: `${piece.left}%`,
            width: piece.size,
            height: piece.size * 1.4,
            background: piece.color,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            transform: `rotate(${piece.rotate}deg)`,
          }}
        />
      ))}
    </div>
  )
}
