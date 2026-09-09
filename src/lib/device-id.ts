const STORAGE_KEY = 'azarov_device_id_v1'

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

/** Anonymous persistent device id — UUID only, no fingerprinting. */
export function getOrCreateDeviceId(): string {
  try {
    const existing = String(localStorage.getItem(STORAGE_KEY) || '')
      .trim()
      .toLowerCase()
    if (isUuid(existing)) {
      return existing
    }
  } catch {
    // private mode / blocked storage
  }

  const created =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4${Math.random()
          .toString(16)
          .slice(2, 5)}-a${Math.random().toString(16).slice(2, 5)}-${Math.random()
          .toString(16)
          .slice(2, 14)}`.slice(0, 36)

  const normalized = created.toLowerCase()
  try {
    localStorage.setItem(STORAGE_KEY, normalized)
  } catch {
    // ignore
  }
  return normalized
}
