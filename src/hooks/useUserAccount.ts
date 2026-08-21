import { useEffect, useState } from 'react'

import { getCurrentAccount, subscribeAccount } from '@/lib/account'
import { bootstrapSession } from '@/lib/session'
import { useTelegramWebApp } from '@/hooks/useTelegramWebApp'
import type { UserAccount } from '@/types/account'

export function useUserAccount() {
  const { isAvailable } = useTelegramWebApp()
  const [account, setAccount] = useState<UserAccount>(() => getCurrentAccount())

  useEffect(() => {
    let cancelled = false

    void bootstrapSession().then((next) => {
      if (!cancelled) {
        setAccount(next)
      }
    })

    const unsubscribe = subscribeAccount(setAccount)

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [isAvailable])

  return account
}
