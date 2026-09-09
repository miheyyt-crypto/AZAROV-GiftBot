import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { CoinBalance } from '@/components/BalanceCard'
import { PartnerBanner } from '@/components/PartnerBanner'
import { PartnerTaskModal } from '@/components/PartnerTaskModal'
import { TaskCard } from '@/components/TaskCard'
import { TaskCategoryFilter } from '@/components/TaskCategoryFilter'
import { TaskDetailSheet } from '@/components/TaskDetailSheet'
import { TasksEmptyState } from '@/components/TasksEmptyState'
import { getPartnerById, getPartners } from '@/data/partners'
import { getTasks } from '@/data/tasks'
import { useUserAccount } from '@/hooks/useUserAccount'
import { getPartnerProgress } from '@/lib/partners'
import {
  filterTasks,
  getVisibleTasks,
  shouldShowPartners,
  shouldShowRegularTasks,
} from '@/lib/tasks'
import type { FilterCategory, Task } from '@/types'

export function Tasks() {
  const account = useUserAccount()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('all')
  const [activePartnerId, setActivePartnerId] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  const partners = useMemo(() => getPartners(), [])
  const allTasks = useMemo(
    () => getVisibleTasks(),
    [
      account.invitedCount,
      account.claimedTaskIds,
      account.startedPartnerTasks,
      account.kickConnected,
      account.kickUserId,
      account.activeReferrals,
    ],
  )

  const filteredTasks = useMemo(
    () => filterTasks(allTasks, activeCategory),
    [allTasks, activeCategory],
  )

  const showPartners = shouldShowPartners()
  const showRegularTasks = shouldShowRegularTasks(activeCategory)

  const hasTasks = filteredTasks.length > 0
  const activePartner = activePartnerId ? getPartnerById(activePartnerId) : null

  useEffect(() => {
    const taskId = String(searchParams.get('task') || '').trim()
    const partnerId = String(searchParams.get('partner') || '').trim()
    if (!taskId && !partnerId) {
      return
    }

    if (taskId) {
      const match =
        allTasks.find((task) => task.id === taskId) ||
        getTasks().find((task) => task.id === taskId)
      if (match) {
        setSelectedTask(match)
      }
    }

    if (partnerId && getPartnerById(partnerId)) {
      setActivePartnerId(partnerId)
    }

    const next = new URLSearchParams(searchParams)
    next.delete('task')
    next.delete('partner')
    setSearchParams(next, { replace: true })
  }, [allTasks, searchParams, setSearchParams])

  return (
    <div className="ui-page">
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
          <span className="rounded-full border border-gold/25 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-gold">
            Партнёры
          </span>
          <span className="text-xs text-muted">самые крупные награды</span>
        </div>
      )}

      {/* Partner banners */}
      {showPartners && (
        <section className="mb-6 space-y-3">
          {partners.map((partner) => {
            const { completed } = getPartnerProgress(
              partner.id,
              account.claimedTaskIds,
              partner.tasks.length,
            )
            return (
              <PartnerBanner
                key={partner.id}
                name={partner.name}
                description={partner.description}
                reward={partner.reward}
                rewardSuffix={partner.rewardSuffix}
                theme={partner.theme}
                image={partner.image}
                completedCount={completed}
                onClick={() => setActivePartnerId(partner.id)}
              />
            )
          })}
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
