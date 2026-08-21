import { useMemo, useState } from 'react'

import { CoinBalance } from '@/components/BalanceCard'
import { PartnerBanner } from '@/components/PartnerBanner'
import { PartnerTaskModal } from '@/components/PartnerTaskModal'
import { TaskCard } from '@/components/TaskCard'
import { TaskCategoryFilter } from '@/components/TaskCategoryFilter'
import { TaskDetailSheet } from '@/components/TaskDetailSheet'
import { TasksEmptyState } from '@/components/TasksEmptyState'
import { getPartnerById, getPartners } from '@/data/partners'
import { useUserAccount } from '@/hooks/useUserAccount'
import {
  filterTasks,
  getVisibleTasks,
  shouldShowPartners,
  shouldShowRegularTasks,
} from '@/lib/tasks'
import type { FilterCategory, Task } from '@/types'

export function Tasks() {
  const account = useUserAccount()
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('all')
  const [activePartnerId, setActivePartnerId] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const partners = useMemo(() => getPartners(), [])
  const allTasks = useMemo(
    () => getVisibleTasks(),
    [account.invitedCount, account.claimedTaskIds, account.startedPartnerTasks],
  )

  const filteredTasks = useMemo(
    () => filterTasks(allTasks, activeCategory),
    [allTasks, activeCategory],
  )

  const showPartners = shouldShowPartners()
  const showRegularTasks = shouldShowRegularTasks(activeCategory)

  const hasTasks = filteredTasks.length > 0
  const activePartner = activePartnerId ? getPartnerById(activePartnerId) : null

  return (
    <div
      className="min-h-full overflow-x-hidden bg-bg-dark px-4 pb-6"
      style={{ paddingTop: 'calc(1rem + var(--safe-area-top))' }}
    >
      {/* Header */}
      <header className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Задания
        </h1>
        <CoinBalance />
      </header>

      {/* Category filters */}
      <div className="mb-5">
        <TaskCategoryFilter
          active={activeCategory}
          onChange={setActiveCategory}
        />
      </div>

      {/* Partners section header */}
      {showPartners && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="rounded-md bg-gold/15 px-2 py-1 text-[10px] font-bold tracking-wider text-gold uppercase">
            Партнёры
          </span>
          <span className="text-xs text-muted">самые крупные награды</span>
        </div>
      )}

      {/* Partner banners */}
      {showPartners && (
        <section className="mb-6 space-y-3">
          {partners.map((partner) => (
            <PartnerBanner
              key={partner.id}
              name={partner.name}
              description={partner.description}
              reward={partner.reward}
              rewardSuffix={partner.rewardSuffix}
              theme={partner.theme}
              image={partner.image}
              onClick={() => setActivePartnerId(partner.id)}
            />
          ))}
        </section>
      )}

      {/* Regular tasks */}
      {showRegularTasks && (
        <section className="space-y-3">
          {hasTasks ? (
            filteredTasks.map((task) => (
              <TaskCard key={task.id} task={task} onOpen={setSelectedTask} />
            ))
          ) : (
            <TasksEmptyState />
          )}
        </section>
      )}

      {activePartner && (
        <PartnerTaskModal
          partner={activePartner}
          onClose={() => setActivePartnerId(null)}
        />
      )}

      {selectedTask && (
        <TaskDetailSheet
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}
