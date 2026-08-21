import { APP_ERROR_MESSAGES, type AppError, type AppErrorCode } from '@/types/errors'

const isDev = import.meta.env.DEV

export function createAppError(code: AppErrorCode, cause?: unknown): AppError {
  const content = APP_ERROR_MESSAGES[code]
  return {
    code,
    title: content.title,
    message: content.message,
    cause,
  }
}

export function toAppError(error: unknown, fallback: AppErrorCode = 'UNKNOWN_ERROR'): AppError {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code
    if (code && code in APP_ERROR_MESSAGES) {
      return createAppError(code as AppErrorCode, error)
    }
  }

  if (error instanceof TypeError && /fetch|network|Failed to fetch/i.test(String(error.message))) {
    return createAppError('NETWORK_ERROR', error)
  }

  if (typeof error === 'string') {
    const mapped = mapMessageToCode(error)
    if (mapped) {
      return createAppError(mapped, error)
    }
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const mapped = mapMessageToCode(String((error as { message: unknown }).message))
    if (mapped) {
      return createAppError(mapped, error)
    }
  }

  return createAppError(fallback, error)
}

function mapMessageToCode(message: string): AppErrorCode | null {
  const lower = message.toLowerCase()
  if (lower.includes('недостаточно') || lower.includes('insufficient')) {
    return 'INSUFFICIENT_BALANCE'
  }
  if (lower.includes('уже') && (lower.includes('выполн') || lower.includes('получен'))) {
    return 'ALREADY_COMPLETED'
  }
  if (lower.includes('сеть') || lower.includes('соединен') || lower.includes('network')) {
    return 'NETWORK_ERROR'
  }
  if (lower.includes('авториз') || lower.includes('сесси')) {
    return 'UNAUTHORIZED'
  }
  return null
}

/** Log technical details in development only — never show raw errors in UI. */
export function logAppError(error: AppError | unknown, context?: string): void {
  if (!isDev) {
    return
  }

  const prefix = context ? `[AppError:${context}]` : '[AppError]'
  console.error(prefix, error)
}

export function getUserFacingError(error: unknown, fallback: AppErrorCode = 'UNKNOWN_ERROR'): AppError {
  const appError = toAppError(error, fallback)
  logAppError(appError)
  return appError
}
