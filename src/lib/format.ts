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
