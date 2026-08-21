import { Check } from 'lucide-react'

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

const categoryTheme: Record<TaskCategory, { border: string; glow: string }> = {
  kick: {
    border: 'border-kick/35',
    glow: 'shadow-[0_0_20px_rgb(83_204_24/12%)]',
  },
  telegram: {
    border: 'border-sky-400/35',
    glow: 'shadow-[0_0_20px_rgb(56_189_248/12%)]',
  },
  social: {
    border: 'border-pink-400/35',
    glow: 'shadow-[0_0_20px_rgb(236_72_153/12%)]',
  },
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
  const theme = categoryTheme[task.category]

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={[
        'w-full overflow-visible rounded-[20px] border bg-white/[0.03] p-4 text-left backdrop-blur-md',
        isLocked ? 'opacity-60' : '',
        isCompleted ? 'border-kick/30' : theme.border,
        isCompleted ? '' : theme.glow,
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        {isImageIcon(task.icon) ? (
          <img
            src={task.icon}
            alt=""
            className="size-[52px] shrink-0 overflow-visible"
            aria-hidden
          />
        ) : (
          <div
            className="flex size-[52px] shrink-0 items-center justify-center rounded-[16px] bg-white/10 text-xl"
            aria-hidden
          >
            {task.icon}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-snug text-white">{task.title}</h3>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                {task.description}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/35 bg-black/30 px-2.5 py-1 text-xs font-bold text-white">
              <span aria-hidden>🪙</span>
              {formatBalance(task.reward)}
            </span>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span
              className={[
                'inline-flex items-center gap-1 text-xs',
                isCompleted ? 'text-kick-light' : 'text-muted',
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
