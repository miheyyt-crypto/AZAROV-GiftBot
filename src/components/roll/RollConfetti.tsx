import { useEffect, useMemo, useState } from 'react'

type RollConfettiProps = {
  active: boolean
  burstKey?: string | null
}

const COLORS = ['#ff6a2b', '#b39ddb', '#4fc3f7', '#66bb6a', '#ffca28', '#ef5350', '#ce93d8', '#4ADE80']

export function RollConfetti({ active, burstKey }: RollConfettiProps) {
  const [visible, setVisible] = useState(false)
  const pieces = useMemo(
    () =>
      Array.from({ length: 22 }, (_, index) => ({
        id: index,
        left: 6 + ((index * 19) % 88),
        delay: (index % 6) * 0.04,
        duration: 0.95 + (index % 4) * 0.1,
        color: COLORS[index % COLORS.length],
        rotate: (index * 51) % 360,
        size: 5 + (index % 3) * 2,
        drift: (index % 2 === 0 ? 1 : -1) * (8 + (index % 5) * 3),
      })),
    [],
  )

  useEffect(() => {
    if (!active || !burstKey) {
      setVisible(false)
      return
    }
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 1800)
    return () => window.clearTimeout(timer)
  }, [active, burstKey])

  if (!visible) {
    return null
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[70] h-[280px] overflow-hidden" aria-hidden>
      {pieces.map((piece) => (
        <span
          key={`${burstKey}-${piece.id}`}
          className="roll-confetti-piece absolute top-2 rounded-[1.5px]"
          style={{
            left: `${piece.left}%`,
            width: piece.size,
            height: piece.size * 1.35,
            background: piece.color,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            ['--roll-confetti-x' as string]: `${piece.drift}px`,
            transform: `rotate(${piece.rotate}deg)`,
          }}
        />
      ))}
    </div>
  )
}
