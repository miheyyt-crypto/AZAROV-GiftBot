import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Outside public/ — never served as static assets.
 * Override base with AZAROV_UPLOADS_DIR (e.g. /data/uploads on Railway Volume).
 */
const uploadsBase = process.env.AZAROV_UPLOADS_DIR
  ? path.resolve(process.env.AZAROV_UPLOADS_DIR)
  : path.resolve(rootDir, 'uploads')
export const UPLOADS_ROOT = path.resolve(uploadsBase, 'partner-submissions')
export const COMMUNITY_UPLOADS_ROOT = path.resolve(uploadsBase, 'community-access')

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024

const ALLOWED_BY_EXT = {
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
}

const ALLOWED_EXT = new Set(Object.keys(ALLOWED_BY_EXT))

const SUBMISSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const FORBIDDEN_NAME_RE =
  /\.(svg|html?|xhtml|js|mjs|cjs|ts|tsx|jsx|exe|bat|cmd|ps1|sh|bash|php|asp|aspx|cgi|jar|war|zip|rar|7z|gz|bz2|xz|dll|so|dylib|msi|scr|com|vbs|wsf|apk|dmg)$/i

const UPLOAD_CATEGORIES = {
  'partner-submissions': UPLOADS_ROOT,
  'community-access': COMMUNITY_UPLOADS_ROOT,
}

export function ensureUploadDir() {
  if (!existsSync(UPLOADS_ROOT)) {
    mkdirSync(UPLOADS_ROOT, { recursive: true })
  }
}

export function ensureCommunityUploadDir() {
  if (!existsSync(COMMUNITY_UPLOADS_ROOT)) {
    mkdirSync(COMMUNITY_UPLOADS_ROOT, { recursive: true })
  }
}

export function isSafeSubmissionId(submissionId) {
  return typeof submissionId === 'string' && SUBMISSION_ID_RE.test(submissionId.trim())
}

function looksLikeSvgOrHtml(buffer) {
  const head = buffer.subarray(0, Math.min(512, buffer.length)).toString('utf8').toLowerCase()
  const trimmed = head.replace(/^\uFEFF/, '').trimStart()
  return (
    trimmed.startsWith('<svg') ||
    trimmed.startsWith('<?xml') ||
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('<script')
  )
}

function looksLikeExecutableOrArchive(buffer) {
  if (buffer.length < 4) {
    return true
  }

  // MZ (Windows PE), ELF, Mach-O, ZIP/JAR (PK), RAR, 7z
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return true
  }
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05)) {
    return true
  }
  if (buffer.toString('ascii', 0, 4) === 'Rar!') return true
  if (
    buffer[0] === 0x37 &&
    buffer[1] === 0x7a &&
    buffer[2] === 0xbc &&
    buffer[3] === 0xaf
  ) {
    return true
  }
  // Shebang scripts
  if (buffer[0] === 0x23 && buffer[1] === 0x21) return true

  return false
}

/**
 * Detect image type from magic bytes only — never trust client filename/MIME.
 */
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null
  }

  if (looksLikeExecutableOrArchive(buffer) || looksLikeSvgOrHtml(buffer)) {
    return null
  }

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return ALLOWED_BY_EXT.jpg
  }

  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return ALLOWED_BY_EXT.png
  }

  // WEBP (RIFF....WEBP)
  const riff = buffer.toString('ascii', 0, 4)
  const webp = buffer.toString('ascii', 8, 12)
  if (riff === 'RIFF' && webp === 'WEBP') {
    return ALLOWED_BY_EXT.webp
  }

  return null
}

export function assertSafeScreenshot(buffer, claimedMime = '', originalName = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, message: 'Добавь скриншот.' }
  }

  if (buffer.length > MAX_SCREENSHOT_BYTES) {
    return { ok: false, message: 'Скриншот больше 5 МБ.' }
  }

  // Reject dangerous original names early (client-controlled, untrusted).
  const name = String(originalName || '')
  if (name && FORBIDDEN_NAME_RE.test(name)) {
    return { ok: false, message: 'Разрешены только JPG, PNG или WEBP.' }
  }

  const detected = detectImageType(buffer)
  if (!detected) {
    return { ok: false, message: 'Разрешены только JPG, PNG или WEBP.' }
  }

  // Claimed MIME is advisory; magic bytes win. Mismatch is ignored, not trusted.
  void claimedMime

  return { ok: true, type: detected }
}

function isPathInsideRoot(absolutePath, root) {
  const resolved = path.resolve(absolutePath)
  const base = path.resolve(root)
  const relative = path.relative(base, resolved)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function isPathInsideUploads(absolutePath) {
  return isPathInsideRoot(absolutePath, UPLOADS_ROOT)
}

/**
 * Store as <submissionId>.<ext> — never use client filename.
 */
export function saveSubmissionScreenshot(submissionId, buffer, ext) {
  if (!isSafeSubmissionId(submissionId)) {
    throw new Error('invalid_submission_id')
  }

  const safeExt = String(ext || '').toLowerCase()
  if (!ALLOWED_EXT.has(safeExt)) {
    throw new Error('invalid_extension')
  }

  ensureUploadDir()
  const fileName = `${submissionId.trim()}.${safeExt}`
  const absolutePath = path.resolve(UPLOADS_ROOT, fileName)

  if (!isPathInsideUploads(absolutePath)) {
    throw new Error('invalid_upload_path')
  }

  writeFileSync(absolutePath, buffer)

  return {
    fileName,
    relativePath: `partner-submissions/${fileName}`,
    absolutePath,
  }
}

/**
 * Store community-access screenshot as <id>.<ext> under community-access/.
 */
export function saveCommunityScreenshot(requestId, buffer, ext) {
  if (!isSafeSubmissionId(requestId)) {
    throw new Error('invalid_submission_id')
  }

  const safeExt = String(ext || '').toLowerCase()
  if (!ALLOWED_EXT.has(safeExt)) {
    throw new Error('invalid_extension')
  }

  ensureCommunityUploadDir()
  const fileName = `${requestId.trim()}.${safeExt}`
  const absolutePath = path.resolve(COMMUNITY_UPLOADS_ROOT, fileName)

  if (!isPathInsideRoot(absolutePath, COMMUNITY_UPLOADS_ROOT)) {
    throw new Error('invalid_upload_path')
  }

  writeFileSync(absolutePath, buffer)

  return {
    fileName,
    relativePath: `community-access/${fileName}`,
    absolutePath,
  }
}

/**
 * Resolve a stored relative path safely (blocks path traversal / encoded dots).
 */
export function resolveSubmissionScreenshotPath(relativePath) {
  return resolveCategoryScreenshotPath(relativePath, 'partner-submissions')
}

export function resolveCommunityScreenshotPath(relativePath) {
  return resolveCategoryScreenshotPath(relativePath, 'community-access')
}

function resolveCategoryScreenshotPath(relativePath, category) {
  const root = UPLOAD_CATEGORIES[category]
  if (!root || !relativePath || typeof relativePath !== 'string') {
    return null
  }

  let decoded = relativePath
  try {
    decoded = decodeURIComponent(relativePath)
  } catch {
    return null
  }

  const normalized = decoded.replace(/\\/g, '/').replace(/\0/g, '')
  if (
    !normalized ||
    normalized.includes('..') ||
    normalized.includes('%2e') ||
    normalized.includes('%2E') ||
    normalized.startsWith('/') ||
    normalized.includes(':') ||
    !normalized.startsWith(`${category}/`)
  ) {
    return null
  }

  const parts = normalized.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== category) {
    return null
  }

  const fileName = parts[1]
  const match = fileName.match(/^([0-9a-f-]{36})\.(jpg|png|webp)$/i)
  if (!match || !isSafeSubmissionId(match[1])) {
    return null
  }

  const candidates = [
    path.resolve(root, `${match[1]}.${match[2].toLowerCase()}`),
    path.resolve(root, `${match[1].toLowerCase()}.${match[2].toLowerCase()}`),
  ]

  for (const candidate of candidates) {
    if (isPathInsideRoot(candidate, root) && existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

export function deleteSubmissionScreenshot(relativePath) {
  const absolutePath = resolveSubmissionScreenshotPath(relativePath)
  if (!absolutePath) {
    return false
  }

  try {
    unlinkSync(absolutePath)
    return true
  } catch {
    return false
  }
}

export function deleteCommunityScreenshot(relativePath) {
  const absolutePath = resolveCommunityScreenshotPath(relativePath)
  if (!absolutePath) {
    return false
  }

  try {
    unlinkSync(absolutePath)
    return true
  } catch {
    return false
  }
}

export function createSubmissionId() {
  return crypto.randomUUID()
}

/** Multer helper: reject dangerous original filenames before buffering completes. */
export function isForbiddenOriginalName(originalName) {
  const name = String(originalName || '')
  if (!name) {
    return false
  }
  return FORBIDDEN_NAME_RE.test(name)
}
