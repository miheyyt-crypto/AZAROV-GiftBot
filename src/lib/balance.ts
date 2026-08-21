import { getCurrentAccount } from '@/lib/account'
import type { UserBalance } from '@/types'

type BalanceListener = (balance: UserBalance) => void

const listeners = new Set<BalanceListener>()

function toBalance(amount: number): UserBalance {
  return {
    amount: Math.max(0, amount),
    currency: 'coins',
  }
}

function notify(balance: UserBalance): void {
  for (const listener of listeners) {
    listener(balance)
  }
}

/** Read-only mirror of the last server-authoritative account snapshot. */
export function getBalance(): UserBalance {
  return toBalance(getCurrentAccount().balance)
}

/**
 * Client-side balance mutation is disabled.
 * Balance changes only after the server responds and hydrateBalanceFromAccount runs.
 */
export function setBalance(_amount?: number): UserBalance {
  return getBalance()
}

export function creditBalance(_amount?: number): UserBalance {
  return getBalance()
}

export function debitBalance(_amount?: number): UserBalance {
  return getBalance()
}

export function formatBalance(balance: UserBalance | number = getBalance()): string {
  const amount = typeof balance === 'number' ? balance : balance.amount
  return new Intl.NumberFormat('ru-RU').format(amount)
}

export function subscribeBalance(listener: BalanceListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function hydrateBalanceFromAccount(): UserBalance {
  const balance = getBalance()
  notify(balance)
  return balance
}
