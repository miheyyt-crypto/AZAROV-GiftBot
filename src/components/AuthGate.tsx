import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { LoginScreen } from '@/components/LoginScreen'
import {
  completeTelegramWebLogin,
  getWebAuthUser,
  isMiniAppAuthAvailable,
  logoutCurrentWebSession,
  subscribeAuth,
} from '@/lib/auth'
import { bootstrapSession } from '@/lib/session'
import type { AuthStatus, TelegramLoginWidgetUser } from '@/types/auth'

interface AuthContextValue {
  status: AuthStatus
  logout: () => Promise<void>
  isWebSession: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const BOOTSTRAP_TIMEOUT_MS = 12_000

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used within AuthGate')
  }
  return value
}

interface AuthGateProps {
  children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => subscribeAuth(() => setTick((value) => value + 1)), [])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      setStatus('loading')
      setError(null)

      const timeout = window.setTimeout(() => {
        if (!cancelled) {
          setStatus((current) => (current === 'loading' ? 'unauthenticated' : current))
          setError('Не удалось проверить сессию. Попробуй войти снова.')
        }
      }, BOOTSTRAP_TIMEOUT_MS)

      try {
        await bootstrapSession()
        if (cancelled) {
          return
        }

        if (isMiniAppAuthAvailable()) {
          setStatus('authenticated')
          return
        }

        const webUser = getWebAuthUser()
        if (webUser && webUser.id > 0 && !webUser.isDemo) {
          setStatus('authenticated')
        } else {
          setStatus('unauthenticated')
        }
      } catch {
        if (!cancelled) {
          setStatus('unauthenticated')
          setError('Не удалось проверить сессию. Попробуй войти снова.')
        }
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void boot()

    return () => {
      cancelled = true
    }
  }, [])

  const handleTelegramAuth = useCallback(async (payload: TelegramLoginWidgetUser) => {
    setLoginBusy(true)
    setError(null)

    try {
      if (!payload?.id || !payload?.hash || !payload?.auth_date) {
        throw new Error('Telegram вернул неполные данные входа.')
      }

      await completeTelegramWebLogin(payload)
      setStatus('authenticated')
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Не удалось войти через Telegram. Попробуй ещё раз.'
      setError(message)
      setStatus('unauthenticated')
    } finally {
      setLoginBusy(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await logoutCurrentWebSession()
    setError(null)
    // Stay on login screen — do not re-run boot (avoids loading flash / race with cleared cookie).
    setStatus('unauthenticated')
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      logout,
      isWebSession: !isMiniAppAuthAvailable() && Boolean(getWebAuthUser()),
    }),
    [status, logout],
  )

  if (status === 'loading') {
    return (
      <div
        className="flex min-h-full flex-col items-center justify-center gap-3 bg-bg-dark px-6"
        role="status"
        aria-live="polite"
      >
        <div className="size-10 animate-spin rounded-full border-2 border-neon-purple/30 border-t-neon-purple" />
        <p className="text-sm text-muted">Загрузка…</p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <AuthContext.Provider value={value}>
        <LoginScreen
          loading={loginBusy}
          error={error}
          onTelegramAuth={(user) => {
            void handleTelegramAuth(user)
          }}
        />
      </AuthContext.Provider>
    )
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
