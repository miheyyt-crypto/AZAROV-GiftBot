import { isAdminTelegramUser } from './telegram-notify.mjs'
import { withStore, withStoreRead } from './store.mjs'

export const MAINTENANCE_CODE = 'MAINTENANCE'
export const MAINTENANCE_MESSAGE = 'Ведутся тех. работы'

function ensureAppSettings(store) {
  store.appSettings = store.appSettings || {}
  if (typeof store.appSettings.maintenanceMode !== 'boolean') {
    store.appSettings.maintenanceMode = false
  }
  return store.appSettings
}

export function isMaintenanceModeOnStore(store) {
  return Boolean(ensureAppSettings(store).maintenanceMode)
}

export function isMaintenanceMode() {
  return withStoreRead((store) => isMaintenanceModeOnStore(store))
}

export function setMaintenanceMode(enabled) {
  return withStore((store) => {
    const settings = ensureAppSettings(store)
    settings.maintenanceMode = Boolean(enabled)
    settings.maintenanceUpdatedAt = new Date().toISOString()
    return {
      success: true,
      maintenanceMode: settings.maintenanceMode,
      updatedAt: settings.maintenanceUpdatedAt,
    }
  })
}

export function toggleMaintenanceMode() {
  return withStore((store) => {
    const settings = ensureAppSettings(store)
    settings.maintenanceMode = !Boolean(settings.maintenanceMode)
    settings.maintenanceUpdatedAt = new Date().toISOString()
    return {
      success: true,
      maintenanceMode: settings.maintenanceMode,
      updatedAt: settings.maintenanceUpdatedAt,
    }
  })
}

/**
 * Allow admins through during maintenance; block everyone else.
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function assertAppAccessForTelegramUser(telegramUserId) {
  if (!isMaintenanceMode()) {
    return { ok: true }
  }
  if (isAdminTelegramUser(telegramUserId)) {
    return { ok: true }
  }
  return {
    ok: false,
    code: MAINTENANCE_CODE,
    message: MAINTENANCE_MESSAGE,
  }
}

export function maintenanceDeniedPayload() {
  return {
    success: false,
    code: MAINTENANCE_CODE,
    message: MAINTENANCE_MESSAGE,
  }
}
