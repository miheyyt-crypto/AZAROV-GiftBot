import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.03] px-6 py-12 text-center">
      {icon && <div className="mb-3 text-3xl" aria-hidden>{icon}</div>}
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
