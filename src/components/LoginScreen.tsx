import { TelegramLoginButton } from '@/components/TelegramLoginButton'
import { APP_NAME } from '@/lib/constants'
import type { TelegramLoginWidgetUser } from '@/types/auth'

interface LoginScreenProps {
  loading: boolean
  error: string | null
  onTelegramAuth: (user: TelegramLoginWidgetUser) => void
}

export function LoginScreen({ loading, error, onTelegramAuth }: LoginScreenProps) {
  return (
    <div
      className="flex min-h-full flex-col items-center justify-center bg-bg-dark px-6"
      style={{ paddingTop: 'calc(1.5rem + var(--safe-area-top))', paddingBottom: '2rem' }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="mb-2 text-xs font-semibold tracking-[0.2em] text-neon-purple uppercase">
            AZAROV
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-white">{APP_NAME}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Войди через Telegram, чтобы сохранять прогресс, монеты и задания.
          </p>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-gradient-to-b from-white/[0.06] to-bg-surface/80 p-6 shadow-[0_12px_40px_rgb(0_0_0/35%)] backdrop-blur-md">
          <p className="mb-5 text-center text-sm font-medium text-white">
            Вход через Telegram
          </p>

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-4" role="status" aria-live="polite">
              <div className="size-9 animate-spin rounded-full border-2 border-neon-purple/30 border-t-neon-purple" />
              <p className="text-sm text-muted">Проверяем вход…</p>
            </div>
          ) : null}

          {/* Keep widget mounted (hidden while verifying) so Telegram iframe is not destroyed mid-flow. */}
          <div className={loading ? 'hidden' : undefined}>
            <TelegramLoginButton onAuth={onTelegramAuth} disabled={loading} />
          </div>

          {error ? (
            <p
              className="mt-4 rounded-xl border border-pink/30 bg-pink/10 px-3 py-2 text-center text-sm text-pink-200"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-muted">
          Мы не получаем пароль Telegram. Вход подтверждается официальным виджетом Telegram, а
          сессия создаётся на сервере.
        </p>
      </div>
    </div>
  )
}
