import { useEffect, useState } from 'react'

import {
  creditBalance,
  debitBalance,
  formatBalance,
  getBalance,
  setBalance,
  subscribeBalance,
} from '@/lib/balance'
import type { UserBalance } from '@/types'

export function useBalance() {
  const [balance, setBalanceState] = useState<UserBalance>(() => getBalance())

  useEffect(() => subscribeBalance(setBalanceState), [])

  return {
    balance,
    amount: balance.amount,
    formatted: formatBalance(balance),
    setBalance,
    creditBalance,
    debitBalance,
  }
}
