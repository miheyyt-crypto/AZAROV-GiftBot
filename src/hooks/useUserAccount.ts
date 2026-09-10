import { useAuth } from '@/components/AuthGate'
import { getCurrentAccount, subscribeAccount } from '@/lib/account'
import { bootstrapSession } from '@/lib/session'
import { useTelegramWebApp } from '@/hooks/useTelegramWebApp'
import type { UserAccount } from '@/types/account'
import { useEffect, useState } from 'react'

export function useUserAccount() {
  const { isAvailable } = useTelegramWebApp()
  const { sessionReady } = useAuth()
  const [account, setAccount] = useState<UserAccount>(() => getCurrentAccount())

  useEffect(() => {
    let cancelled = false

    void bootstrapSession().then((result) => {
      if (!cancelled && result.confirmed) {
        setAccount(result.account)
      }
    })

    const unsubscribe = subscribeAccount(setAccount)

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [isAvailable])

  useEffect(() => {
    if (sessionReady) {
      setAccount(getCurrentAccount())
    }
  }, [sessionReady])

  return account
}
