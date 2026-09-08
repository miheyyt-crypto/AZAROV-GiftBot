import type { AppStoreData } from '@/types/account'

const STORAGE_KEY = 'azarov-giftbot:store:v1'

const emptyStore = (): AppStoreData => ({
  version: 1,
  users: {},
})

function isStoreData(value: unknown): value is AppStoreData {
  if (!value || typeof value !== 'object') {
    return false
  }

  const data = value as AppStoreData
  return data.version === 1 && typeof data.users === 'object' && data.users !== null
}

/**
 * Client-side cache of the last account snapshot from the API.
 * Backend remains the source of truth for balance, tasks, orders, and rewards.
 * Do not invent or mutate critical economy state from localStorage alone.
 */
export function loadStore(): AppStoreData {
  if (typeof window === 'undefined') {
    return emptyStore()
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return emptyStore()
    }

    const parsed: unknown = JSON.parse(raw)
    return isStoreData(parsed) ? parsed : emptyStore()
  } catch {
    return emptyStore()
  }
}

export function saveStore(store: AppStoreData): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}
