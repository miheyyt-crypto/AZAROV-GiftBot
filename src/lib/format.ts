export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function formatAbsoluteDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelativeDay(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((startToday.getTime() - startThat.getTime()) / 86_400_000)

  if (diffDays === 0) {
    return 'Сегодня'
  }
  if (diffDays === 1) {
    return 'Вчера'
  }

  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}

export function formatOrderListDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const day = formatRelativeDay(value)
  const time = date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return `${day}, ${time}`
}

/** Relative time for notification lists (same ru-RU style as other profile dates). */
export function formatRelativeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) {
    return formatAbsoluteDateTime(value)
  }

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) {
    return 'только что'
  }
  if (minutes < 60) {
    return `${minutes} мин. назад`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return hours === 1 ? '1 час назад' : `${hours} ч. назад`
  }

  const days = Math.floor(hours / 24)
  if (days < 7) {
    return days === 1 ? 'вчера' : `${days} дн. назад`
  }

  return formatAbsoluteDateTime(value)
}
