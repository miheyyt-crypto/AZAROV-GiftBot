import { getBotToken, telegramApi } from './telegram-notify.mjs'

/** In-memory cache: file_id → { buffer, contentType, expiresAt }. */
const fileCache = new Map()
const DEFAULT_TTL_MS = 55 * 60 * 1000
const MAX_CACHE_ENTRIES = 40

function guessContentType(filePath) {
  const lower = String(filePath || '').toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

export function clearTelegramFileCache() {
  fileCache.clear()
}

/**
 * Resolve Telegram file_id to a Buffer via getFile + file download.
 * Caches bytes for ~55 minutes (Telegram file links expire in ~1h).
 */
export async function fetchTelegramFileById(fileId, options = {}) {
  const id = String(fileId || '').trim()
  if (!id) {
    return { ok: false, error: 'missing_file_id' }
  }

  const now = Date.now()
  const cached = fileCache.get(id)
  if (cached && cached.expiresAt > now) {
    return {
      ok: true,
      buffer: cached.buffer,
      contentType: cached.contentType,
      fromCache: true,
    }
  }

  const token = getBotToken()
  if (!token) {
    return { ok: false, error: 'bot_token_missing' }
  }

  const meta = await telegramApi('getFile', { file_id: id }, options)
  if (!meta.ok || !meta.result?.file_path) {
    return {
      ok: false,
      error: meta.error || 'get_file_failed',
      description: meta.description || null,
    }
  }

  const filePath = String(meta.result.file_path)
  const fetchImpl = options.fetchImpl || fetch
  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`

  let response
  try {
    response = await fetchImpl(fileUrl)
  } catch (error) {
    return {
      ok: false,
      error: 'network_error',
      message: error instanceof Error ? error.message : 'network_error',
    }
  }

  if (!response.ok) {
    return { ok: false, error: 'download_failed', status: response.status }
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const contentType =
    String(response.headers?.get?.('content-type') || '').split(';')[0].trim() ||
    guessContentType(filePath)

  if (fileCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = fileCache.keys().next().value
    if (oldest != null) {
      fileCache.delete(oldest)
    }
  }

  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS
  fileCache.set(id, {
    buffer,
    contentType,
    expiresAt: now + ttlMs,
  })

  return { ok: true, buffer, contentType, fromCache: false }
}
