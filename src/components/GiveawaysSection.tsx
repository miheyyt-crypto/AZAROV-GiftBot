import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { GiveawayCard } from '@/components/GiveawayCard'
import { GiveawayTabs } from '@/components/GiveawayTabs'
import { GiveawaysEmptyState } from '@/components/GiveawaysEmptyState'
import { ROUTES } from '@/lib/constants'
import { fetchGiveaways, getGiveawaysByTab } from '@/lib/giveaways'
import type { Giveaway, GiveawaysLoadState, GiveawayTab } from '@/types/giveaway'

interface GiveawaysSectionProps {
  /** Initial tab when the section mounts. */
  initialTab?: GiveawayTab
  /** Show the «Все» link to the full giveaways route. */
  showAllLink?: boolean
}

function GiveawaysSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3" aria-hidden>
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03]"
        >
          <div className="aspect-[5/4] animate-pulse bg-white/[0.04]" />
          <div className="space-y-2 p-2.5">
            <div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.06]" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/[0.04]" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function GiveawaysSection({
  initialTab = 'active',
  showAllLink = true,
}: GiveawaysSectionProps) {
  const [tab, setTab] = useState<GiveawayTab>(initialTab)
  const [items, setItems] = useState<Giveaway[]>([])
  const [loadState, setLoadState] = useState<GiveawaysLoadState>('loading')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadState('loading')
      try {
        const result = await fetchGiveaways()
        if (cancelled) {
          return
        }
        setItems(result.items)
        setLoadState('ready')
      } catch {
        if (cancelled) {
          return
        }
        setItems([])
        setLoadState('error')
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(() => getGiveawaysByTab(items, tab), [items, tab])

  function handleRetry() {
    setLoadState('loading')
    void fetchGiveaways()
      .then((result) => {
        setItems(result.items)
        setLoadState('ready')
      })
      .catch(() => {
        setItems([])
        setLoadState('error')
      })
  }

  return (
    <section aria-labelledby="home-giveaways-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="home-giveaways-title" className="text-2xl font-bold tracking-tight text-white">
          Розыгрыши
        </h2>

        {showAllLink ? (
          <Link
            to={ROUTES.giveaways}
            className="shrink-0 rounded-full border border-kick/35 bg-kick/10 px-3 py-1 text-[12px] font-semibold text-kick transition-[filter,background-color] hover:bg-kick/15"
          >
            Все
          </Link>
        ) : null}
      </div>

      <GiveawayTabs active={tab} onChange={setTab} />

      <div className="mt-4">
        {loadState === 'loading' ? <GiveawaysSkeleton /> : null}

        {loadState === 'error' ? (
          <GiveawaysEmptyState
            title="Не удалось загрузить"
            description="Проверьте соединение и попробуйте ещё раз."
            actionLabel="Повторить"
            onAction={handleRetry}
          />
        ) : null}

        {loadState === 'ready' && tab === 'active' && visible.length === 0 ? (
          <GiveawaysEmptyState
            title="Нет активных розыгрышей"
            description="Загляните в завершённые или следите за анонсами."
            actionLabel="Посмотреть историю"
            onAction={() => setTab('completed')}
          />
        ) : null}

        {loadState === 'ready' && tab === 'completed' && visible.length === 0 ? (
          <GiveawaysEmptyState
            title="Нет завершённых розыгрышей"
            description="Когда розыгрыши закончатся, они появятся здесь."
          />
        ) : null}

        {loadState === 'ready' && visible.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {visible.map((giveaway) => (
              <GiveawayCard key={giveaway.id} giveaway={giveaway} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
