import { useEffect, useState } from 'react'

import {
  getBootPreloadSnapshot,
  subscribeBootPreload,
  type BootPreloadSnapshot,
} from '@/lib/boot-preload'

/**
 * Full-screen cold-start UI with settle-based progress (0–100).
 * Sits under the HTML #azarov-boot-splash until that splash is dismissed.
 */
export function BootLoadingScreen({ snapshot }: { snapshot?: BootPreloadSnapshot }) {
  const [live, setLive] = useState<BootPreloadSnapshot>(() => snapshot ?? getBootPreloadSnapshot())

  useEffect(() => {
    if (snapshot) {
      setLive(snapshot)
      return
    }
    return subscribeBootPreload(setLive)
  }, [snapshot])

  const progress = live.progress
  const label = live.label

  return (
    <div
      className="fixed inset-0 z-[99990] flex flex-col items-center justify-center bg-black px-6"
      style={{
        paddingTop: 'max(1.25rem, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 0px))',
      }}
      role="status"
      aria-live="polite"
      aria-busy={!live.complete}
      aria-label={label}
    >
      <p className="m-0 text-center text-[clamp(1.05rem,4.2vw,1.35rem)] font-bold tracking-wide text-slate-50">
        Загрузка Бота...
      </p>
      <p className="mt-3 max-w-[18rem] text-center text-[13px] text-white/55">{label}</p>
      <div
        className="mt-6 h-1.5 w-full max-w-[16rem] overflow-hidden rounded-full bg-white/10"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-white/85"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-2 text-[12px] tabular-nums text-white/45">{progress}%</p>
    </div>
  )
}
