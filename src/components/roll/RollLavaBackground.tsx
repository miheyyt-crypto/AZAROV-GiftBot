/** Soft GPU-friendly lava-lamp background for Roll (CSS blobs only). */
export function RollLavaBackground({ phase }: { phase: string }) {
  const intensity =
    phase === 'spinning' || phase === 'locked'
      ? 'roll-lava--spin'
      : phase === 'completed'
        ? 'roll-lava--result'
        : 'roll-lava--idle'

  return (
    <div className={`roll-lava pointer-events-none absolute inset-0 z-0 overflow-hidden ${intensity}`} aria-hidden>
      <div className="roll-lava__base" />
      <div className="roll-lava__blob roll-lava__blob--a" />
      <div className="roll-lava__blob roll-lava__blob--b" />
      <div className="roll-lava__blob roll-lava__blob--c" />
      <div className="roll-lava__blob roll-lava__blob--d" />
      <div className="roll-lava__sparks" />
      <div className="roll-lava__vignette" />
    </div>
  )
}
