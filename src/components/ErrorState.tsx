interface ErrorStateProps {
  title: string
  message: string
  onRetry?: () => void
  retryLabel?: string
}

export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = 'Повторить',
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.03] px-6 py-12 text-center">
      <p className="text-3xl" aria-hidden>
        ⚠️
      </p>
      <h2 className="mt-4 text-lg font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-2xl bg-[#9b4dff] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgb(155_77_255/35%)]"
        >
          {retryLabel}
        </button>
      )}
    </div>
  )
}
