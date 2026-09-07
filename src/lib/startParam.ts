/**
 * Telegram Mini App start_param capture.
 *
 * Telegram may expose the launch value as:
 * - initData `start_param` (signed, preferred)
 * - initDataUnsafe.start_param
 * - query/hash `tgWebAppStartParam`
 * - query `startapp` (when our bot button appends it to WEBAPP_URL)
 *
 * Capture must happen BEFORE WebApp.ready() when possible — some clients
 * clear the hash after the WebApp object is initialized.
 */

export const START_PARAM_STORAGE_KEY = 'azarov_tg_start_param'

export function extractStartParamFromInitData(initData: string): string {
  if (!initData) {
    return ''
  }
  try {
    return new URLSearchParams(initData).get('start_param')?.trim() || ''
  } catch {
    return ''
  }
}

export function extractStartParamFromLocation(
  search: string,
  hash: string,
): string {
  try {
    const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    const fromQuery =
      query.get('tgWebAppStartParam')?.trim() || query.get('startapp')?.trim() || ''
    if (fromQuery) {
      return fromQuery
    }

    const rawHash = hash.replace(/^#/, '')
    if (!rawHash) {
      return ''
    }
    const hashParams = new URLSearchParams(rawHash.startsWith('?') ? rawHash.slice(1) : rawHash)
    return (
      hashParams.get('tgWebAppStartParam')?.trim() ||
      hashParams.get('startapp')?.trim() ||
      ''
    )
  } catch {
    return ''
  }
}

function readStoredStartParam(): string {
  if (typeof sessionStorage === 'undefined') {
    return ''
  }
  try {
    return sessionStorage.getItem(START_PARAM_STORAGE_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

function writeStoredStartParam(value: string): void {
  if (!value || typeof sessionStorage === 'undefined') {
    return
  }
  try {
    sessionStorage.setItem(START_PARAM_STORAGE_KEY, value)
  } catch {
    // Ignore quota / private mode failures.
  }
}

/**
 * Persist start_param from every available Telegram launch source.
 * Safe to call many times; first non-empty value wins in storage.
 */
export function captureStartParam(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const webApp = window.Telegram?.WebApp
  const fromInitData = extractStartParamFromInitData(webApp?.initData || '')
  const fromUnsafe = webApp?.initDataUnsafe?.start_param?.trim() || ''
  const fromLocation = extractStartParamFromLocation(window.location.search, window.location.hash)
  const fromStorage = readStoredStartParam()

  const found = fromInitData || fromUnsafe || fromLocation || fromStorage
  if (found) {
    writeStoredStartParam(found)
  }
  return found
}

export function getCapturedStartParam(): string {
  return captureStartParam()
}

export function clearStoredStartParam(): void {
  if (typeof sessionStorage === 'undefined') {
    return
  }
  try {
    sessionStorage.removeItem(START_PARAM_STORAGE_KEY)
  } catch {
    // ignore
  }
}
