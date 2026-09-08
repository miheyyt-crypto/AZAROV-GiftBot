import { AlertTriangle, CheckCircle2, Info, ShoppingBag, X } from 'lucide-react'

export interface ServerToastCopy {
  tone: 'success' | 'error' | 'info'
  title: string
  message?: string
}

interface ServerNotificationToastProps {
  copy: ServerToastCopy
  onOpen: () => void
  onDismiss: () => void
  reducedMotion?: boolean
}

const styles: Record<
  ServerToastCopy['tone'],
  { wrap: string; icon: typeof CheckCircle2; iconClass: string }
> = {
  success: {
    wrap: 'border-kick/40 bg-[#122016]/95 shadow-[0_0_24px_rgb(83_204_24/20%)]',
    icon: CheckCircle2,
    iconClass: 'text-kick',
  },
  error: {
    wrap: 'border-pink/45 bg-[#1a1016]/95 shadow-[0_0_24px_rgb(236_72_153/20%)]',
    icon: AlertTriangle,
    iconClass: 'text-pink',
  },
  info: {
    wrap: 'border-neon-purple/40 bg-[#14101c]/95 shadow-[0_0_24px_rgb(168_85_247/20%)]',
    icon: Info,
    iconClass: 'text-neon-purple',
  },
}

function iconFor(copy: ServerToastCopy) {
  if (copy.title.includes('Заказ')) {
    return ShoppingBag
  }
  return styles[copy.tone].icon
}

export function ServerNotificationToast({
  copy,
  onOpen,
  onDismiss,
  reducedMotion = false,
}: ServerNotificationToastProps) {
  const theme = styles[copy.tone]
  const Icon = iconFor(copy)

  return (
    <div
      className={[
        'pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-[18px] border px-3.5 py-3 backdrop-blur-xl',
        reducedMotion ? '' : 'server-toast-enter',
        theme.wrap,
      ].join(' ')}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onOpen}
        className="press-none flex min-w-0 flex-1 items-start gap-3 text-left"
        aria-label={`${copy.title}${copy.message ? `. ${copy.message}` : ''}`}
      >
        <span
          className={[
            'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5',
            theme.iconClass,
          ].join(' ')}
        >
          <Icon size={18} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-white">{copy.title}</span>
          {copy.message ? (
            <span className="mt-0.5 block text-xs leading-relaxed text-white/70">
              {copy.message}
            </span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70"
        aria-label="Закрыть"
      >
        <X size={14} />
      </button>
    </div>
  )
}
