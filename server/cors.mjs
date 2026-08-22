import { URL } from 'node:url'

function normalizeOrigin(value) {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
}

function defaultDevOrigins() {
  return [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ]
}

export function getAllowedOrigins() {
  const fromEnv = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeOrigin)
    .filter(Boolean)

  const webapp = String(process.env.WEBAPP_URL || '').trim()
  if (webapp) {
    const origin = normalizeOrigin(webapp)
    if (origin) {
      fromEnv.push(origin)
    }
  }

  const unique = [...new Set(fromEnv)]
  if (unique.length > 0) {
    return unique
  }

  if (process.env.NODE_ENV !== 'production') {
    return defaultDevOrigins()
  }

  return []
}

export function createCorsMiddleware() {
  const allowed = getAllowedOrigins()

  return (req, res, next) => {
    const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    const normalized = requestOrigin ? normalizeOrigin(requestOrigin) : ''

    const shouldDebugLog = Boolean(requestOrigin) || String(req.path || '').includes('/assets')
    if (shouldDebugLog) {
      console.log('[CORS_DEBUG] --- incoming request ---')
      console.log('[CORS_DEBUG] req.method:', req.method)
      console.log('[CORS_DEBUG] req.path:', req.path)
      console.log('[CORS_DEBUG] requestOrigin:', requestOrigin)
      console.log('[CORS_DEBUG] normalized:', normalized)
      console.log('[CORS_DEBUG] process.env.WEBAPP_URL:', process.env.WEBAPP_URL)
      console.log('[CORS_DEBUG] allowed:', allowed)
    }

    if (normalized && allowed.includes(normalized)) {
      res.setHeader('Access-Control-Allow-Origin', normalized)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Credentials', 'true')
    } else if (!requestOrigin && process.env.NODE_ENV !== 'production') {
      // Same-origin / curl / Telegram WebView without Origin in local dev.
      res.setHeader('Access-Control-Allow-Origin', allowed[0] || 'http://127.0.0.1:5173')
    }

    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Admin-Key')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    if (req.method === 'OPTIONS') {
      if (requestOrigin && normalized && !allowed.includes(normalized)) {
        console.log(
          '[CORS_DEBUG] 403 triggered: OPTIONS request with requestOrigin set, normalized set, but not in allowed list.',
          { req_method: req.method, req_path: req.path, requestOrigin, normalized, allowed },
        )
        res.status(403).json({ success: false, message: 'Origin не разрешён.' })
        return
      }
      res.status(204).end()
      return
    }

    if (requestOrigin && normalized && !allowed.includes(normalized)) {
      console.log(
        '[CORS_DEBUG] 403 triggered: non-OPTIONS request with requestOrigin set, normalized set, but not in allowed list.',
        { req_method: req.method, req_path: req.path, requestOrigin, normalized, allowed },
      )
      res.status(403).json({ success: false, message: 'Origin не разрешён.' })
      return
    }

    next()
  }
}
