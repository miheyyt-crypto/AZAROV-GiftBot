import { StoreCorruptError } from './store.mjs'

export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.expose = true
  }
}

export const SAFE_INTERNAL_MESSAGE = 'Что-то пошло не так. Попробуй ещё раз.'

export function logServerError(error, context = {}) {
  const payload = {
    ...context,
    name: error?.name,
    message: error?.message,
    code: error?.code,
    stack: error?.stack,
  }
  console.error('[API Error]', payload)
}

export function sendSafeError(res, error) {
  if (error instanceof HttpError) {
    const body = {
      success: false,
      message: error.message || SAFE_INTERNAL_MESSAGE,
    }
    if (error.code) {
      body.code = error.code
    }
    res.status(error.status || 500).json(body)
    return
  }

  if (error instanceof StoreCorruptError || error?.code === 'STORE_CORRUPT') {
    logServerError(error, { kind: 'store_corrupt' })
    res.status(503).json({
      success: false,
      message: 'Хранилище временно недоступно. Данные не были изменены.',
      code: 'STORE_CORRUPT',
    })
    return
  }

  if (error?.message === 'store_lock_timeout') {
    logServerError(error, { kind: 'store_busy' })
    res.status(503).json({
      success: false,
      message: 'Сервер занят. Попробуй ещё раз через пару секунд.',
      code: 'STORE_BUSY',
    })
    return
  }

  logServerError(error)
  res.status(500).json({
    success: false,
    message: SAFE_INTERNAL_MESSAGE,
  })
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}
