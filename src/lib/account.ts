import { loadStore, saveStore } from '@/lib/storage'
import type { UserAccount } from '@/types/account'

type AccountListener = (account: UserAccount) => void

const listeners = new Set<AccountListener>()

let currentTelegramId: number | null = null

function accountKey(telegramId: number): string {
  return String(telegramId)
}

function notify(account: UserAccount): void {
  for (const listener of listeners) {
    listener(account)
  }
}

export function createAccount(telegramId: number): UserAccount {
  return {
    telegramId,
    referralCode: '',
    referralLink: '',
    referredBy: null,
    referredByUserId: null,
    balance: 0,
    invitedCount: 0,
    invitedUserIds: [],
    activeReferrals: 0,
    pendingCount: 0,
    referralEarnings: 0,
    kickConnected: false,
    kickUserId: null,
    kickUsername: null,
    kickDisplayName: null,
    kickAvatarUrl: null,
    referralRewardGranted: false,
    claimedTaskIds: [],
    startedPartnerTasks: [],
    openedReferralCases: 0,
  }
}

function normalizeAccount(account: UserAccount, telegramId: number): UserAccount {
  const merged = {
    ...createAccount(telegramId),
    ...account,
    telegramId,
  }

  return {
    ...merged,
    referralCode: merged.referralCode || '',
    referralLink: merged.referralLink || '',
    invitedUserIds: merged.invitedUserIds ?? [],
    claimedTaskIds: merged.claimedTaskIds ?? merged.completedTasks ?? [],
    startedPartnerTasks: merged.startedPartnerTasks ?? [],
    openedReferralCases: Math.max(0, merged.openedReferralCases ?? 0),
    pendingCount: merged.pendingCount ?? 0,
    referredByUserId: merged.referredByUserId ?? null,
    balance: Math.max(0, merged.balance ?? 0),
    kickConnected: Boolean(merged.kickConnected || merged.kickUserId),
    kickUserId: merged.kickUserId ?? null,
    kickUsername: merged.kickUsername ?? null,
    kickDisplayName: merged.kickDisplayName ?? null,
    kickAvatarUrl: merged.kickAvatarUrl ?? null,
  }
}

export function getAccount(telegramId: number): UserAccount | null {
  const store = loadStore()
  const account = store.users[accountKey(telegramId)]
  return account ? normalizeAccount(account, telegramId) : null
}

export function saveAccount(account: UserAccount): UserAccount {
  const store = loadStore()
  const next = normalizeAccount(account, account.telegramId)
  store.users[accountKey(next.telegramId)] = next
  saveStore(store)

  if (currentTelegramId === next.telegramId) {
    notify(next)
  }

  return next
}

export function ensureAccount(telegramId: number): UserAccount {
  const existing = getAccount(telegramId)

  if (existing) {
    return existing
  }

  return saveAccount(createAccount(telegramId))
}

export function findAccountByReferralCode(code: string): UserAccount | null {
  const store = loadStore()
  const match = Object.values(store.users).find((account) => account.referralCode === code)

  if (match) {
    return normalizeAccount(match, match.telegramId)
  }

  return null
}

export function setCurrentTelegramId(telegramId: number): UserAccount {
  currentTelegramId = telegramId
  const account = ensureAccount(telegramId)
  notify(account)
  return account
}

export function clearCurrentAccount(): void {
  currentTelegramId = null
  notify(createAccount(0))
}

export function getCurrentTelegramId(): number {
  return currentTelegramId ?? 0
}

export function getCurrentAccount(): UserAccount {
  if (currentTelegramId == null || currentTelegramId <= 0) {
    return createAccount(0)
  }
  return ensureAccount(currentTelegramId)
}

export function updateCurrentAccount(
  updater: (account: UserAccount) => UserAccount,
): UserAccount {
  const next = updater(getCurrentAccount())
  return saveAccount(next)
}

export function applyAccountSnapshot(account: UserAccount): UserAccount {
  currentTelegramId = account.telegramId
  return saveAccount(account)
}

export function subscribeAccount(listener: AccountListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
