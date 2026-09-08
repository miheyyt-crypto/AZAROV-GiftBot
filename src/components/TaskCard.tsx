import { Check } from 'lucide-react'

import { CoinIcon } from '@/components/CoinIcon'
import { formatBalance } from '@/lib/balance'
import type { Task, TaskCategory } from '@/types'

interface TaskCardProps {
  task: Task
  onOpen: (task: Task) => void
}

const statusLabels: Record<Task['status'], string> = {
  available: 'Не выполнено',
  in_progress: 'В процессе',
  completed: 'Выполнено',
  locked: 'Заблокировано',
}

const categoryAccent: Record<TaskCategory, string> = {
  kick: 'bg-kick',
  telegram: 'bg-telegram',
  social: 'bg-pink',
}

function isImageIcon(icon: string): boolean {
  return (
    icon.endsWith('.svg') ||
    icon.endsWith('.png') ||
    icon.includes('/assets/') ||
    icon.startsWith('data:')
  )
}

export function TaskCard({ task, onOpen }: TaskCardProps) {
  const isCompleted = task.status === 'completed'
  const isLocked = task.status === 'locked'

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={[
        'ui-card relative w-full overflow-hidden p-4 text-left',
        isLocked ? 'opacity-55' : '',
        isCompleted ? 'opacity-75' : '',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0 bottom-0 left-0 w-0.5',
          isCompleted ? 'bg-success/70' : categoryAccent[task.category],
        ].join(' ')}
        aria-hidden
      />

      <div className="flex items-start gap-3 pl-1">
        {isImageIcon(task.icon) ? (
          <img
            src={task.icon}
            alt=""
            className="size-[52px] shrink-0 overflow-visible"
            aria-hidden
          />
        ) : (
          <div
            className="flex size-[52px] shrink-0 items-center justify-center rounded-2xl bg-white/8 text-xl"
            aria-hidden
          >
            {task.icon}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-white">
                {task.title}
              </h3>
              <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-text-secondary">
                {task.description}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/30 bg-black/30 px-2.5 py-1 text-[13px] font-bold text-white">
              <CoinIcon className="size-3.5" />
              {formatBalance(task.reward)}
            </span>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span
              className={[
                'inline-flex items-center gap-1 text-xs font-medium',
                isCompleted ? 'text-success' : 'text-muted',
              ].join(' ')}
            >
              {isCompleted && <Check size={14} aria-hidden />}
              {statusLabels[task.status]}
            </span>
            {!isCompleted && !isLocked && (
              <span className="text-xs font-semibold text-neon-purple">Открыть</span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
