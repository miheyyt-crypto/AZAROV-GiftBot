import compression from 'compression'

/**
 * Prefer Brotli, fall back to gzip/deflate for compressible text responses.
 * Uses Express `compression@1.8+` (streaming-safe with express.static / sendFile).
 *
 * Skips already-compressed binary assets. Does not alter Cache-Control.
 */

const SKIP_PATH =
  /\.(?:webp|avif|jpe?g|png|gif|ico|zip|gz|br|woff2?|ttf|otf|mp[34]|webm|wasm|7z|rar|bz2)$/i

const SKIP_TYPE =
  /^(?:image\/(?:webp|jpeg|jpg|png|gif|avif|x-icon)|audio\/|video\/|application\/(?:zip|gzip|wasm|octet-stream))/i

/**
 * Express middleware — register early (before routes / static).
 */
export function createHttpCompressionMiddleware() {
  return compression({
    threshold: 256,
    level: 6,
    brotli: {
      enabled: true,
    },
    filter(req, res) {
      if (req.headers['x-no-compression']) {
        return false
      }
      if (SKIP_PATH.test(req.path || '')) {
        return false
      }
      const type = String(res.getHeader('Content-Type') || '')
        .split(';')[0]
        .trim()
      if (type && SKIP_TYPE.test(type)) {
        return false
      }
      return compression.filter(req, res)
    },
  })
}
