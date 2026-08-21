export type AppErrorCode =
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_BALANCE'
  | 'ALREADY_COMPLETED'
  | 'ALREADY_PURCHASED'
  | 'INVALID_ACTION'
  | 'RATE_LIMITED'
  | 'UNKNOWN_ERROR'

export interface AppError {
  code: AppErrorCode
  title: string
  message: string
  /** Optional original error for development logging only */
  cause?: unknown
}

export interface AppErrorContent {
  title: string
  message: string
}

export const APP_ERROR_MESSAGES: Record<AppErrorCode, AppErrorContent> = {
  NETWORK_ERROR: {
    title: 'Нет соединения',
    message: 'Проверь интернет и попробуй ещё раз.',
  },
  SERVER_ERROR: {
    title: 'Ошибка сервера',
    message: 'Не удалось выполнить действие. Попробуй позже.',
  },
  UNAUTHORIZED: {
    title: 'Сессия истекла',
    message: 'Открой приложение заново.',
  },
  FORBIDDEN: {
    title: 'Недостаточно прав',
    message: 'Это действие недоступно для твоего аккаунта.',
  },
  NOT_FOUND: {
    title: 'Не найдено',
    message: 'Запрошенные данные недоступны.',
  },
  INSUFFICIENT_BALANCE: {
    title: 'Недостаточно монет',
    message: 'Попробуй выполнить задания или пригласи друзей.',
  },
  ALREADY_COMPLETED: {
    title: 'Уже выполнено',
    message: 'Ты уже получал награду за это задание.',
  },
  ALREADY_PURCHASED: {
    title: 'Уже приобретено',
    message: 'Этот товар уже находится в твоих заказах.',
  },
  INVALID_ACTION: {
    title: 'Недоступно',
    message: 'Это действие сейчас нельзя выполнить.',
  },
  RATE_LIMITED: {
    title: 'Слишком много запросов',
    message: 'Подожди немного и попробуй снова.',
  },
  UNKNOWN_ERROR: {
    title: 'Что-то пошло не так',
    message: 'Попробуй ещё раз.',
  },
}

export type LoadState = 'loading' | 'success' | 'error' | 'empty'
