import { AlertTriangle, CheckCircle2, Gift, Info, X, XCircle } from 'lucide-react'

import type { AppNotification, NotificationType } from '@/types/notification'

interface NotificationToastProps {
  notification: AppNotification
  onDismiss: () => void
}

const styles: Record<
  NotificationType,
  { wrap: string; icon: typeof CheckCircle2; iconClass: string }
> = {
  success: {
    wrap: 'border-kick/40 bg-[#122016]/95 shadow-[0_0_24px_rgb(83_204_24/20%)]',
    icon: CheckCircle2,
    iconClass: 'text-kick',
  },
  reward: {
    wrap: 'border-gold/45 bg-[#1a1620]/95 shadow-[0_0_24px_rgb(251_191_36/22%)]',
    icon: Gift,
    iconClass: 'text-gold',
  },
  warning: {
    wrap: 'border-amber-400/45 bg-[#1a1610]/95 shadow-[0_0_24px_rgb(251_191_36/18%)]',
    icon: AlertTriangle,
    iconClass: 'text-amber-300',
  },
  error: {
    wrap: 'border-pink/45 bg-[#1a1016]/95 shadow-[0_0_24px_rgb(236_72_153/20%)]',
    icon: XCircle,
    iconClass: 'text-pink',
  },
  info: {
    wrap: 'border-neon-purple/40 bg-[#14101c]/95 shadow-[0_0_24px_rgb(168_85_247/20%)]',
    icon: Info,
    iconClass: 'text-neon-purple',
  },
}

export function NotificationToast({ notification, onDismiss }: NotificationToastProps) {
  const theme = styles[notification.type]
  const Icon = theme.icon

  return (
    <div
      className={[
        'pointer-events-auto flex w-full items-start gap-3 rounded-[18px] border px-3.5 py-3 backdrop-blur-xl',
        'animate-[toast-in_220ms_cubic-bezier(0.22,1,0.36,1)]',
        theme.wrap,
      ].join(' ')}
      role="status"
    >
      <span
        className={[
          'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/5',
          theme.iconClass,
        ].join(' ')}
      >
        <Icon size={18} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{notification.title}</p>
        {notification.message && (
          <p className="mt-0.5 text-xs leading-relaxed text-white/70">{notification.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/70"
        aria-label="Закрыть уведомление"
      >
        <X size={14} />
      </button>
    </div>
  )
}
