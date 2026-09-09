import {
  createGiveaway,
  listAdminGiveaways,
  notifyGiveawayTelegramJobs,
} from './giveaways.mjs'
import {
  answerTelegramCallback,
  isAdminTelegramUser,
} from './telegram-notify.mjs'

/** Per-admin create wizard. Keys are string telegram user ids. */
const pendingGiveawayByAdmin = new Map()
const WIZARD_TTL_MS = 30 * 60 * 1000
const WINNERS_MAX = 1000

export const GIVEAWAY_DURATION_PRESETS = [
  { id: '1m', label: '1 минута', ms: 60_000 },
  { id: '2m', label: '2 минуты', ms: 2 * 60_000 },
  { id: '5m', label: '5 минут', ms: 5 * 60_000 },
  { id: '10m', label: '10 минут', ms: 10 * 60_000 },
  { id: '30m', label: '30 минут', ms: 30 * 60_000 },
  { id: '1h', label: '1 час', ms: 60 * 60_000 },
  { id: '24h', label: '24 часа', ms: 24 * 60 * 60_000 },
]

export function clearPendingGiveawayWizards() {
  pendingGiveawayByAdmin.clear()
}

export function getPendingGiveawayWizard(adminId) {
  const key = String(adminId ?? '').trim()
  const entry = pendingGiveawayByAdmin.get(key)
  if (!entry) {
    return null
  }
  if (entry.expiresAt < Date.now()) {
    pendingGiveawayByAdmin.delete(key)
    return null
  }
  return entry
}

function setPendingGiveawayWizard(adminId, patch) {
  const key = String(adminId)
  const prev = getPendingGiveawayWizard(adminId) || {
    step: 'idle',
    prizeAmount: null,
    winnersCount: null,
    durationMs: null,
    durationLabel: null,
  }
  pendingGiveawayByAdmin.set(key, {
    ...prev,
    ...patch,
    expiresAt: Date.now() + WIZARD_TTL_MS,
  })
}

function clearPendingGiveawayWizard(adminId) {
  pendingGiveawayByAdmin.delete(String(adminId))
}

export function answerGiveawayCallback(ctx, text = undefined, showAlert = false) {
  return Promise.resolve()
    .then(() => {
      if (typeof ctx?.answerCbQuery === 'function') {
        return ctx.answerCbQuery(text, { show_alert: showAlert })
      }
      return null
    })
    .catch(async () => {
      const id = ctx?.callbackQuery?.id
      if (id) {
        await answerTelegramCallback(id, { text, showAlert })
      }
    })
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatDateRu(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
  } catch {
    return String(iso || '')
  }
}

function defaultGiveawayImage() {
  const base = String(process.env.WEBAPP_URL || '')
    .trim()
    .replace(/\/$/, '')
  if (base) {
    return `${base}/icons.svg`
  }
  return 'https://azarov-giftbot-production.up.railway.app/icons.svg'
}

export function parseDurationInput(raw) {
  const text = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
  if (!text) {
    return null
  }

  const preset = GIVEAWAY_DURATION_PRESETS.find(
    (item) => item.id === text || item.label.replace(/\s+/g, '') === text,
  )
  if (preset) {
    return preset
  }

  const match = /^(\d+)(м|m|мин|минута|минуты|минут|ч|h|час|часа|часов)$/i.exec(text)
  if (!match) {
    return null
  }
  const amount = Number(match[1])
  if (!Number.isInteger(amount) || amount <= 0) {
    return null
  }
  const unit = match[2].toLowerCase()
  const isHour = unit.startsWith('ч') || unit === 'h' || unit.startsWith('час')
  const ms = isHour ? amount * 3_600_000 : amount * 60_000
  if (ms > 7 * 24 * 3_600_000) {
    return null
  }
  const label = isHour
    ? amount === 1
      ? '1 час'
      : `${amount} ч`
    : amount === 1
      ? '1 минута'
      : `${amount} мин`
  return { id: `${amount}${isHour ? 'h' : 'm'}`, label, ms }
}

export function parsePrizeAmountInput(raw) {
  const text = String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(',', '.')
  if (!/^\d+$/.test(text)) {
    return { ok: false, message: 'Введите целое число больше 0. Например: 100' }
  }
  const value = Number(text)
  if (!Number.isInteger(value) || value <= 0 || value > 1_000_000_000) {
    return { ok: false, message: 'Приз должен быть целым числом больше 0.' }
  }
  return { ok: true, value }
}

export function parseWinnersCountInput(raw) {
  const text = String(raw || '')
    .trim()
    .replace(/\s+/g, '')
  if (!/^\d+$/.test(text)) {
    return {
      ok: false,
      message: `Введите целое число от 1 до ${WINNERS_MAX}. Например: 1`,
    }
  }
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1 || value > WINNERS_MAX) {
    return {
      ok: false,
      message: `Количество победителей: целое число от 1 до ${WINNERS_MAX}.`,
    }
  }
  return { ok: true, value }
}

export function buildGiveawayAdminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '➕ Создать розыгрыш', callback_data: 'gw:create' }],
      [{ text: '📋 Активные розыгрыши', callback_data: 'gw:active' }],
      [{ text: '📜 История розыгрышей', callback_data: 'gw:history' }],
      [{ text: '◀️ Назад', callback_data: 'gw:back' }],
    ],
  }
}

export function buildGiveawayDurationKeyboard() {
  const rows = []
  for (let i = 0; i < GIVEAWAY_DURATION_PRESETS.length; i += 2) {
    const left = GIVEAWAY_DURATION_PRESETS[i]
    const right = GIVEAWAY_DURATION_PRESETS[i + 1]
    const row = [{ text: left.label, callback_data: `gw:dur:${left.id}` }]
    if (right) {
      row.push({ text: right.label, callback_data: `gw:dur:${right.id}` })
    }
    rows.push(row)
  }
  rows.push([{ text: '❌ Отмена', callback_data: 'gw:cancel' }])
  return { inline_keyboard: rows }
}

export function buildGiveawayConfirmKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Создать', callback_data: 'gw:confirm' },
        { text: '❌ Отмена', callback_data: 'gw:cancel' },
      ],
    ],
  }
}

export function buildGiveawayActiveKeyboard() {
  return {
    inline_keyboard: [[{ text: '🔄 Обновить', callback_data: 'gw:active' }]],
  }
}

export function buildGiveawayStartAdminKeyboard() {
  return {
    inline_keyboard: [[{ text: '🎁 Розыгрыши', callback_data: 'gw:menu' }]],
  }
}

function winnerDisplay(giveaway) {
  const winners = Array.isArray(giveaway.winners) ? giveaway.winners : []
  if (winners.length === 0) {
    const ids = Array.isArray(giveaway.winnerIds) ? giveaway.winnerIds : []
    if (ids.length === 0) {
      return '—'
    }
    return ids.map((id) => `id:${id}`).join(', ')
  }
  return winners
    .map((w) => {
      if (w.username) {
        return `@${w.username}`
      }
      if (w.firstName) {
        return w.firstName
      }
      return `id:${w.userId}`
    })
    .join(', ')
}

function formatActiveGiveawayBlock(giveaway) {
  return [
    `🎁 Розыгрыш <code>${escapeHtml(giveaway.id)}</code>`,
    '',
    `💰 Приз: ${Number(giveaway.prizeAmount || 0).toLocaleString('ru-RU')} монет`,
    `🏆 Победителей: ${Number(giveaway.winnersCount) || 0}`,
    `👥 Участников: ${Number(giveaway.participantsCount) || 0}`,
    `⏱ Окончание: ${escapeHtml(formatDateRu(giveaway.endAt))}`,
  ].join('\n')
}

function formatHistoryGiveawayBlock(giveaway) {
  return [
    `🎁 Розыгрыш <code>${escapeHtml(giveaway.id)}</code>`,
    `💰 ${Number(giveaway.prizeAmount || 0).toLocaleString('ru-RU')} монет`,
    `🏆 Победитель: ${escapeHtml(winnerDisplay(giveaway))}`,
    `👥 Участников: ${Number(giveaway.participantsCount) || 0}`,
    `🏁 Завершён: ${escapeHtml(formatDateRu(giveaway.completedAt || giveaway.endAt))}`,
  ].join('\n')
}

async function requireAdminCtx(ctx) {
  const adminId = ctx.from?.id
  if (!isAdminTelegramUser(adminId)) {
    console.warn('[giveaway-admin] denied — not in ADMIN_TELEGRAM_IDS', {
      adminId: adminId != null ? String(adminId) : null,
    })
    if (ctx.callbackQuery) {
      await answerGiveawayCallback(ctx, '⛔ Недостаточно прав', true)
    } else if (typeof ctx.reply === 'function') {
      await ctx.reply('⛔ Недостаточно прав.')
    }
    return null
  }
  return String(adminId)
}

async function replyHtml(ctx, text, extra = {}) {
  return ctx.reply(text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  })
}

export async function sendGiveawayAdminMenu(ctx) {
  const adminId = await requireAdminCtx(ctx)
  if (!adminId) {
    return true
  }
  await replyHtml(
    ctx,
    ['🎁 <b>Управление розыгрышами</b>', '', 'Выберите действие:'].join('\n'),
    { reply_markup: buildGiveawayAdminMenuKeyboard() },
  )
  return true
}

async function startCreateWizard(ctx, adminId) {
  setPendingGiveawayWizard(adminId, {
    step: 'await_prize',
    prizeAmount: null,
    winnersCount: null,
    durationMs: null,
    durationLabel: null,
  })
  await replyHtml(
    ctx,
    [
      '🎁 <b>Создание розыгрыша</b>',
      '',
      'Введите размер приза в монетах.',
      '',
      'Например: <code>100</code>',
      '',
      'Отмена: /cancel или кнопка ❌ Отмена',
    ].join('\n'),
    {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'gw:cancel' }]],
      },
    },
  )
}

async function showConfirm(ctx, adminId, wizard) {
  const now = new Date()
  const end = new Date(now.getTime() + wizard.durationMs)
  const text = [
    '🎁 <b>СОЗДАНИЕ РОЗЫГРЫША</b>',
    '',
    `💰 Приз: ${wizard.prizeAmount.toLocaleString('ru-RU')} монет`,
    `🏆 Победителей: ${wizard.winnersCount}`,
    `⏱ Длительность: ${escapeHtml(wizard.durationLabel)}`,
    '',
    'После создания:',
    '▶️ Начало: сейчас',
    `🏁 Окончание: ${escapeHtml(formatDateRu(end.toISOString()))}`,
  ].join('\n')
  setPendingGiveawayWizard(adminId, { step: 'await_confirm' })
  await replyHtml(ctx, text, { reply_markup: buildGiveawayConfirmKeyboard() })
}

async function createFromWizard(ctx, adminId, wizard) {
  const now = new Date()
  const end = new Date(now.getTime() + wizard.durationMs)
  const title = `Розыгрыш ${wizard.prizeAmount.toLocaleString('ru-RU')} монет`
  const result = createGiveaway(
    {
      title,
      description: `Автоматический розыгрыш. Победителей: ${wizard.winnersCount}.`,
      image: defaultGiveawayImage(),
      prizeType: 'coins',
      prizeAmount: wizard.prizeAmount,
      prizeText: null,
      winnersCount: wizard.winnersCount,
      startAt: now.toISOString(),
      endAt: end.toISOString(),
    },
    { createdBy: `tg:${adminId}` },
  )

  clearPendingGiveawayWizard(adminId)

  if (!result.success) {
    await replyHtml(
      ctx,
      `❌ Не удалось создать розыгрыш.\n${escapeHtml(result.message || result.code || '')}`,
    )
    return
  }

  const g = result.giveaway
  await replyHtml(
    ctx,
    [
      '🎉 <b>РОЗЫГРЫШ ЗАПУЩЕН</b>',
      '',
      `🎁 Приз: ${Number(g.prizeAmount || 0).toLocaleString('ru-RU')} монет`,
      `🏆 Победителей: ${Number(g.winnersCount) || 0}`,
      `⏱ Длительность: ${escapeHtml(wizard.durationLabel)}`,
      '',
      '▶️ Начало: сейчас',
      `🏁 Окончание: ${escapeHtml(formatDateRu(g.endAt))}`,
      '',
      `ID: <code>${escapeHtml(g.id)}</code>`,
    ].join('\n'),
    { reply_markup: buildGiveawayAdminMenuKeyboard() },
  )
}

async function showActiveGiveaways(ctx) {
  const listed = listAdminGiveaways()
  if (listed.telegramJobs?.length) {
    void notifyGiveawayTelegramJobs(listed.telegramJobs)
  }
  const active = (listed.giveaways || []).filter((item) => item.status === 'active')
  if (active.length === 0) {
    await replyHtml(ctx, '📋 Сейчас нет активных розыгрышей.', {
      reply_markup: buildGiveawayActiveKeyboard(),
    })
    return
  }

  const chunks = active.slice(0, 10).map(formatActiveGiveawayBlock)
  await replyHtml(ctx, ['📋 <b>Активные розыгрыши</b>', '', ...chunks].join('\n\n'), {
    reply_markup: buildGiveawayActiveKeyboard(),
  })
}

async function showHistoryGiveaways(ctx) {
  const listed = listAdminGiveaways()
  if (listed.telegramJobs?.length) {
    void notifyGiveawayTelegramJobs(listed.telegramJobs)
  }
  const completed = (listed.giveaways || [])
    .filter((item) => item.status === 'completed')
    .slice(0, 10)

  if (completed.length === 0) {
    await replyHtml(ctx, '📜 История пока пуста.', {
      reply_markup: buildGiveawayAdminMenuKeyboard(),
    })
    return
  }

  const chunks = completed.map(formatHistoryGiveawayBlock)
  await replyHtml(ctx, ['📜 <b>История розыгрышей</b>', '', ...chunks].join('\n\n'), {
    reply_markup: buildGiveawayAdminMenuKeyboard(),
  })
}

/**
 * Handle giveaway admin callbacks. Returns true if handled.
 */
export async function handleGiveawayAdminCallback(ctx) {
  const data = String(ctx.callbackQuery?.data || '').trim()
  if (!data.startsWith('gw:')) {
    return false
  }

  const adminId = await requireAdminCtx(ctx)
  if (!adminId) {
    return true
  }

  if (data === 'gw:menu') {
    await answerGiveawayCallback(ctx)
    await sendGiveawayAdminMenu(ctx)
    return true
  }

  if (data === 'gw:back' || data === 'gw:cancel') {
    clearPendingGiveawayWizard(adminId)
    await answerGiveawayCallback(ctx, data === 'gw:cancel' ? 'Отменено' : undefined)
    if (data === 'gw:back') {
      await replyHtml(ctx, 'Готово. Откройте /admin чтобы вернуться в меню розыгрышей.')
    } else {
      await replyHtml(ctx, '❌ Создание розыгрыша отменено.', {
        reply_markup: buildGiveawayAdminMenuKeyboard(),
      })
    }
    return true
  }

  if (data === 'gw:create') {
    await answerGiveawayCallback(ctx)
    await startCreateWizard(ctx, adminId)
    return true
  }

  if (data === 'gw:active') {
    await answerGiveawayCallback(ctx)
    await showActiveGiveaways(ctx)
    return true
  }

  if (data === 'gw:history') {
    await answerGiveawayCallback(ctx)
    await showHistoryGiveaways(ctx)
    return true
  }

  const durMatch = /^gw:dur:([a-z0-9]+)$/i.exec(data)
  if (durMatch) {
    const wizard = getPendingGiveawayWizard(adminId)
    if (!wizard || wizard.step !== 'await_duration') {
      await answerGiveawayCallback(ctx, 'Сначала начните создание заново', true)
      return true
    }
    const preset = GIVEAWAY_DURATION_PRESETS.find((item) => item.id === durMatch[1])
    if (!preset) {
      await answerGiveawayCallback(ctx, 'Неизвестная длительность', true)
      return true
    }
    setPendingGiveawayWizard(adminId, {
      step: 'await_confirm',
      durationMs: preset.ms,
      durationLabel: preset.label,
    })
    await answerGiveawayCallback(ctx)
    await showConfirm(ctx, adminId, {
      ...wizard,
      durationMs: preset.ms,
      durationLabel: preset.label,
    })
    return true
  }

  if (data === 'gw:confirm') {
    const wizard = getPendingGiveawayWizard(adminId)
    if (
      !wizard ||
      wizard.step !== 'await_confirm' ||
      !wizard.prizeAmount ||
      !wizard.winnersCount ||
      !wizard.durationMs
    ) {
      await answerGiveawayCallback(ctx, 'Нет данных для создания', true)
      return true
    }
    await answerGiveawayCallback(ctx, 'Создаём…')
    await createFromWizard(ctx, adminId, wizard)
    return true
  }

  await answerGiveawayCallback(ctx)
  return true
}

/**
 * Consume plain text for giveaway create wizard. Returns true if handled.
 */
export async function handleGiveawayWizardMessage(ctx) {
  const adminId = ctx.from?.id
  if (!adminId) {
    return false
  }

  const wizard = getPendingGiveawayWizard(adminId)
  if (!wizard || wizard.step === 'idle' || wizard.step === 'await_confirm') {
    return false
  }

  if (!isAdminTelegramUser(adminId)) {
    clearPendingGiveawayWizard(adminId)
    return false
  }

  const text = String(ctx.message?.text || '').trim()
  const lower = text.toLowerCase()
  if (lower === 'отмена' || lower === 'cancel') {
    clearPendingGiveawayWizard(adminId)
    await replyHtml(ctx, '❌ Создание розыгрыша отменено.', {
      reply_markup: buildGiveawayAdminMenuKeyboard(),
    })
    return true
  }

  if (wizard.step === 'await_prize') {
    const parsed = parsePrizeAmountInput(text)
    if (!parsed.ok) {
      await replyHtml(ctx, `⚠ ${escapeHtml(parsed.message)}`)
      return true
    }
    setPendingGiveawayWizard(adminId, {
      step: 'await_winners',
      prizeAmount: parsed.value,
    })
    await replyHtml(
      ctx,
      [
        '🏆 Введите количество победителей.',
        '',
        'Например: <code>1</code>',
        '',
        `Допустимо: 1–${WINNERS_MAX}`,
      ].join('\n'),
      {
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'gw:cancel' }]],
        },
      },
    )
    return true
  }

  if (wizard.step === 'await_winners') {
    const parsed = parseWinnersCountInput(text)
    if (!parsed.ok) {
      await replyHtml(ctx, `⚠ ${escapeHtml(parsed.message)}`)
      return true
    }
    setPendingGiveawayWizard(adminId, {
      step: 'await_duration',
      winnersCount: parsed.value,
    })
    await replyHtml(
      ctx,
      [
        '⏱ Выберите длительность розыгрыша.',
        '',
        'Можно нажать кнопку или написать, например: <code>2м</code>, <code>1ч</code>',
      ].join('\n'),
      { reply_markup: buildGiveawayDurationKeyboard() },
    )
    return true
  }

  if (wizard.step === 'await_duration') {
    const duration = parseDurationInput(text)
    if (!duration) {
      await replyHtml(
        ctx,
        '⚠ Не понял длительность. Пример: <code>2м</code>, <code>10м</code>, <code>1ч</code>, <code>24ч</code>',
        { reply_markup: buildGiveawayDurationKeyboard() },
      )
      return true
    }
    setPendingGiveawayWizard(adminId, {
      step: 'await_confirm',
      durationMs: duration.ms,
      durationLabel: duration.label,
    })
    await showConfirm(ctx, adminId, {
      ...wizard,
      durationMs: duration.ms,
      durationLabel: duration.label,
    })
    return true
  }

  return false
}

export async function handleGiveawayCancelCommand(ctx) {
  const adminId = ctx.from?.id
  if (!adminId || !isAdminTelegramUser(adminId)) {
    return false
  }
  const wizard = getPendingGiveawayWizard(adminId)
  if (!wizard) {
    return false
  }
  clearPendingGiveawayWizard(adminId)
  await replyHtml(ctx, '❌ Создание розыгрыша отменено.', {
    reply_markup: buildGiveawayAdminMenuKeyboard(),
  })
  return true
}

export async function handleGiveawayAdminCommand(ctx) {
  const adminId = await requireAdminCtx(ctx)
  if (!adminId) {
    return true
  }
  await sendGiveawayAdminMenu(ctx)
  return true
}
