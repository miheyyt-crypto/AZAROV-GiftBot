interface TasksEmptyStateProps {
  message?: string
}

export function TasksEmptyState({
  message = 'Пока нет доступных заданий',
}: TasksEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-white/5 bg-white/[0.02] px-6 py-12 text-center backdrop-blur-sm">
      <p className="text-sm text-muted">{message}</p>
    </div>
  )
}
