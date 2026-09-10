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
import { armBootSplashWatchdog, signalAppBootReady } from '@/lib/boot-splash'
import { captureStartParam } from '@/lib/startParam'
import { bootstrapSession, sessionBootLog } from '@/lib/session'
import { initTelegramWebApp } from '@/lib/telegram'
import type { AuthStatus, TelegramLoginWidgetUser } from '@/types/auth'

interface AuthContextValue {
  status: AuthStatus
  /** True only after server-confirmed session (not raw initData). */
  sessionReady: boolean
  logout: () => Promise<void>
  isWebSession: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

const BOOTSTRAP_TIMEOUT_MS = 30_000

function peekMiniAppAuth(): boolean {
  try {
    captureStartParam()
    initTelegramWebApp()
  } catch {
    // ignore — AuthGate still boots normally
  }
  return isMiniAppAuthAvailable()
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used within AuthGate')
  }
  return value
}

/**
 * Safe outside AuthGate (returns false). Use for hooks that may run above the provider
 * (e.g. legacy callers) without throwing into ErrorBoundary.
 */
export function useSessionReady(): boolean {
  return Boolean(useContext(AuthContext)?.sessionReady)
}

interface AuthGateProps {
  children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const miniAppAtBoot = useMemo(() => peekMiniAppAuth(), [])
  const [status, setStatus] = useState<AuthStatus>(() =>
    miniAppAtBoot ? 'authenticated' : 'loading',
  )
  const [sessionReady, setSessionReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => subscribeAuth(() => setTick((value) => value + 1)), [])

  useEffect(() => {
    armBootSplashWatchdog()
  }, [])

  useEffect(() => {
    sessionBootLog('sessionReady/status', { sessionReady, status })
    if (sessionReady || status === 'unauthenticated') {
      sessionBootLog('appBootReady signal')
      signalAppBootReady()
    }
  }, [sessionReady, status])

  useEffect(() => {
    let cancelled = false
    sessionBootLog('AuthGate boot effect start', { miniAppAtBoot })

    async function boot() {
      setError(null)

      if (!miniAppAtBoot) {
        setStatus('loading')
      }

      const timeout = window.setTimeout(() => {
        if (!cancelled) {
          sessionBootLog('AuthGate boot timeout')
        }
      }, BOOTSTRAP_TIMEOUT_MS)

      try {
        const result = await bootstrapSession()
        if (cancelled) {
          sessionBootLog('AuthGate boot ignored (cancelled after StrictMode remount)')
          return
        }

        if (!result.confirmed) {
          setSessionReady(false)
          setStatus('unauthenticated')
          setError('Не удалось проверить сессию. Попробуй войти снова.')
          return
        }

        if (isMiniAppAuthAvailable()) {
          setStatus('authenticated')
          setSessionReady(true)
          sessionBootLog('sessionReady changed', { sessionReady: true })
          return
        }

        const webUser = getWebAuthUser()
        if (webUser && webUser.id > 0 && !webUser.isDemo) {
          setStatus('authenticated')
          setSessionReady(true)
          sessionBootLog('sessionReady changed', { sessionReady: true, path: 'web' })
        } else {
          setSessionReady(false)
          setStatus('unauthenticated')
        }
      } catch {
        if (cancelled) {
          sessionBootLog('AuthGate boot error ignored (cancelled)')
          return
        }
        setSessionReady(false)
        setStatus('unauthenticated')
        setError('Не удалось проверить сессию. Попробуй войти снова.')
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void boot()

    return () => {
      sessionBootLog('AuthGate boot effect cleanup')
      cancelled = true
    }
  }, [miniAppAtBoot])

  const handleTelegramAuth = useCallback(async (payload: TelegramLoginWidgetUser) => {
    setLoginBusy(true)
    setError(null)
    setSessionReady(false)

    try {
      if (!payload?.id || !payload?.hash || !payload?.auth_date) {
        throw new Error('Telegram вернул неполные данные входа.')
      }

      await completeTelegramWebLogin(payload)
      setStatus('authenticated')
      setSessionReady(true)
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Не удалось войти через Telegram. Попробуй ещё раз.'
      setError(message)
      setStatus('unauthenticated')
      setSessionReady(false)
    } finally {
      setLoginBusy(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await logoutCurrentWebSession()
    setError(null)
    setSessionReady(false)
    setStatus('unauthenticated')
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      sessionReady,
      logout,
      isWebSession: !isMiniAppAuthAvailable() && Boolean(getWebAuthUser()),
    }),
    [status, sessionReady, logout],
  )

  if (status === 'loading') {
    return null
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
