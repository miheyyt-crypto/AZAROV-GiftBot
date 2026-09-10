import { useSessionReady } from '@/components/AuthGate'
import { getCurrentAccount, subscribeAccount } from '@/lib/account'
import type { UserAccount } from '@/types/account'
import { useEffect, useState } from 'react'

export function useUserAccount() {
  // Must not use throwing useAuth() — App historically calls useAppSession() above AuthGate.
  const sessionReady = useSessionReady()
  const [account, setAccount] = useState<UserAccount>(() => getCurrentAccount())

  // AuthGate owns bootstrapSession(). Parallel mounts here raced StrictMode and aborted /api/session.
  useEffect(() => subscribeAccount(setAccount), [])

  useEffect(() => {
    if (sessionReady) {
      setAccount(getCurrentAccount())
    }
  }, [sessionReady])

  return account
}
