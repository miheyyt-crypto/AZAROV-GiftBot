import {
  createGiveaway,
  isCoinsPrize,
  listAdminGiveaways,
  markPrizeDelivered,
  notifyGiveawayTelegramJobs,
  parseGiveawayId,
} from './giveaways.mjs'
import {
  answerTelegramCallback,
  isAdminTelegramUser,
} from './telegram-notify.mjs'

/** Per-admin create wizard. Keys are string telegram user ids. */
const pendingGiveawayByAdmin = new Map()
const WIZARD_TTL_MS = 30 * 60 * 1000
const WINNERS_MAX = 1000
const CUSTOM_PRIZE_MAX = 500

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
    prizeType: null,
    prizeAmount: null,
    prizeText: null,
    winnersCount: null,
    durationMs: null,
    durationLabel: null,
    imageFileId: null,
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
    return { ok: false, message: 'Введите целое число больше 0. Например: 1000' }
  }
  const value = Number(text)
  if (!Number.isInteger(value) || value <= 0 || value > 1_000_000_000) {
    return { ok: false, message: 'Приз должен быть целым числом больше 0.' }
  }
  return { ok: true, value }
}

export function parseCustomPrizeInput(raw) {
  const value = String(raw || '').trim()
  if (value.length < 1) {
    return { ok: false, message: 'Введите описание приза. Например: 5 000 рублей' }
  }
  if (value.length > CUSTOM_PRIZE_MAX) {
    return {
      ok: false,
      message: `Описание слишком длинное (максимум ${CUSTOM_PRIZE_MAX} символов).`,
    }
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

export function buildGiveawayPrizeTypeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🪙 Монеты', callback_data: 'gw:ptype:coins' },
        { text: '🎁 Свой приз', callback_data: 'gw:ptype:custom' },
      ],
      [{ text: '❌ Отмена', callback_data: 'gw:cancel' }],
    ],
  }
}

function formatPrizeLine(giveawayOrWizard) {
  if (giveawayOrWizard.prizeType === 'coins' || isCoinsPrize(giveawayOrWizard)) {
    const amount = Number(giveawayOrWizard.prizeAmount || giveawayOrWizard.coinsAmount || 0)
    return `🪙 Приз: ${amount.toLocaleString('ru-RU')} монет`
  }
  const text = giveawayOrWizard.prizeText || giveawayOrWizard.customPrize || 'приз'
  return `🎁 Приз: ${text}`
}

function formatDeliveryLine(giveaway) {
  if (isCoinsPrize(giveaway)) {
    return '🎁 Выдача: ✅ Выдан'
  }
  return giveaway.prizeDeliveryStatus === 'delivered'
    ? '🎁 Выдача: ✅ Выдан'
    : '🎁 Выдача: ⏳ Не выдан'
}

function formatWinnerAdminBlock(giveaway) {
  const info = Array.isArray(giveaway.winnersInfo) ? giveaway.winnersInfo : []
  if (info.length === 0) {
    return ['🏆 Победитель: —']
  }
  return info.flatMap((winner, index) => {
    const title = info.length > 1 ? `🏆 Победитель ${index + 1}:` : '🏆 Победитель:'
    const usernameLine = winner.username
      ? `@${winner.username}`
      : '@username отсутствует'
    return [
      title,
      usernameLine,
      `Telegram ID: ${winner.telegramId}`,
    ]
  })
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

export function buildGiveawayImageKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⏭ Пропустить', callback_data: 'gw:skip_image' }],
      [{ text: '❌ Отмена', callback_data: 'gw:cancel' }],
    ],
  }
}

/** Largest Telegram photo size file_id from message.photo[]. */
export function extractLargestPhotoFileId(message) {
  const photos = message?.photo
  if (!Array.isArray(photos) || photos.length === 0) {
    return null
  }
  const largest = photos[photos.length - 1]
  const fileId = String(largest?.file_id || '').trim()
  return fileId || null
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
  const info = Array.isArray(giveaway.winnersInfo) ? giveaway.winnersInfo : []
  if (info.length === 0) {
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
  return info
    .map((w) => {
      if (w.username) {
        return `@${w.username}`
      }
      if (w.firstName) {
        return w.firstName
      }
      return `id:${w.telegramId}`
    })
    .join(', ')
}

function formatImageLine(giveaway) {
  return giveaway.imageFileId
    ? '🖼️ Изображение: ✅ есть'
    : '🖼️ Изображение: ❌ нет'
}

function formatActiveGiveawayBlock(giveaway) {
  return [
    `🎁 Розыгрыш <code>${escapeHtml(giveaway.id)}</code>`,
    '',
    escapeHtml(formatPrizeLine(giveaway)),
    `🏆 Победителей: ${Number(giveaway.winnersCount) || 0}`,
    `👥 Участников: ${Number(giveaway.participantsCount) || 0}`,
    escapeHtml(formatImageLine(giveaway)),
    `⏱ Окончание: ${escapeHtml(formatDateRu(giveaway.endAt))}`,
  ].join('\n')
}

function formatHistoryGiveawayBlock(giveaway) {
  return [
    `🎁 Розыгрыш <code>${escapeHtml(giveaway.id)}</code>`,
    '',
    escapeHtml(formatPrizeLine(giveaway)),
    `🏆 Победителей: ${Number(giveaway.winnersCount) || 0}`,
    `👥 Участников: ${Number(giveaway.participantsCount) || 0}`,
    escapeHtml(formatImageLine(giveaway)),
    '',
    ...formatWinnerAdminBlock(giveaway).map((line) => escapeHtml(line)),
    '',
    escapeHtml(formatDeliveryLine(giveaway)),
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
    step: 'await_prize_type',
    prizeType: null,
    prizeAmount: null,
    prizeText: null,
    winnersCount: null,
    durationMs: null,
    durationLabel: null,
    imageFileId: null,
  })
  await replyHtml(
    ctx,
    ['🎁 <b>Тип приза</b>', '', 'Выберите тип приза для розыгрыша:'].join('\n'),
    { reply_markup: buildGiveawayPrizeTypeKeyboard() },
  )
}

async function askImage(ctx, adminId) {
  setPendingGiveawayWizard(adminId, {
    step: 'await_image',
    imageFileId: null,
  })
  await replyHtml(
    ctx,
    [
      '🖼️ Отправьте изображение для розыгрыша.',
      '',
      'Это изображение будет отображаться в карточке и на странице конкурса.',
      '',
      'Можно отправить фотографию или нажать «Пропустить».',
    ].join('\n'),
    { reply_markup: buildGiveawayImageKeyboard() },
  )
}

async function askPrizeValue(ctx, adminId, prizeType) {
  setPendingGiveawayWizard(adminId, {
    step: 'await_prize',
    prizeType,
    prizeAmount: null,
    prizeText: null,
  })
  if (prizeType === 'coins') {
    await replyHtml(
      ctx,
      [
        '💰 Введите количество монет:',
        '',
        'Например: <code>1000</code>',
        '',
        'Отмена: /cancel',
      ].join('\n'),
      {
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'gw:cancel' }]],
        },
      },
    )
    return
  }
  await replyHtml(
    ctx,
    [
      '🎁 Введите описание приза:',
      '',
      'Например:',
      '<code>5 000 рублей</code>',
      '<code>Steam Gift Card $50</code>',
      '<code>NFT-подарок Telegram</code>',
      '',
      'Отмена: /cancel',
    ].join('\n'),
    {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'gw:cancel' }]],
      },
    },
  )
}

async function askWinners(ctx) {
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
}

function buildConfirmCaption(wizard) {
  const now = new Date()
  const end = new Date(now.getTime() + wizard.durationMs)
  const prizeLine =
    wizard.prizeType === 'coins'
      ? `🪙 Приз: ${Number(wizard.prizeAmount).toLocaleString('ru-RU')} монет`
      : `🎁 Приз: ${escapeHtml(wizard.prizeText)}`
  const imageLine = wizard.imageFileId
    ? '🖼️ Изображение: ✅ добавлено'
    : '🖼️ Изображение: ❌ отсутствует'
  return [
    '🎁 <b>СОЗДАНИЕ РОЗЫГРЫША</b>',
    '',
    prizeLine,
    `🏆 Победителей: ${wizard.winnersCount}`,
    `⏱ Длительность: ${escapeHtml(wizard.durationLabel)}`,
    imageLine,
    '',
    'После создания:',
    '▶️ Начало: сейчас',
    `🏁 Окончание: ${escapeHtml(formatDateRu(end.toISOString()))}`,
    '',
    'Создать розыгрыш?',
  ].join('\n')
}

async function showConfirm(ctx, adminId, wizard) {
  const text = buildConfirmCaption(wizard)
  setPendingGiveawayWizard(adminId, { step: 'await_confirm' })
  const replyMarkup = buildGiveawayConfirmKeyboard()

  if (wizard.imageFileId && typeof ctx.replyWithPhoto === 'function') {
    try {
      await ctx.replyWithPhoto(wizard.imageFileId, {
        caption: text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      })
      return
    } catch (error) {
      console.warn('[giveaway-admin] confirm photo preview failed', {
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
  }

  await replyHtml(ctx, text, { reply_markup: replyMarkup })
}

async function createFromWizard(ctx, adminId, wizard) {
  const now = new Date()
  const end = new Date(now.getTime() + wizard.durationMs)
  const title =
    wizard.prizeType === 'coins'
      ? `Розыгрыш ${Number(wizard.prizeAmount).toLocaleString('ru-RU')} монет`
      : `Розыгрыш: ${String(wizard.prizeText).slice(0, 80)}`
  const result = createGiveaway(
    {
      title,
      description: `Автоматический розыгрыш. Победителей: ${wizard.winnersCount}.`,
      image: defaultGiveawayImage(),
      imageFileId: wizard.imageFileId || null,
      prizeType: wizard.prizeType,
      prizeAmount: wizard.prizeType === 'coins' ? wizard.prizeAmount : null,
      prizeText: wizard.prizeType === 'custom' ? wizard.prizeText : null,
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
      escapeHtml(formatPrizeLine(g)),
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

  const prizeTypeMatch = /^gw:ptype:(coins|custom)$/i.exec(data)
  if (prizeTypeMatch) {
    const wizard = getPendingGiveawayWizard(adminId)
    if (!wizard || wizard.step !== 'await_prize_type') {
      await answerGiveawayCallback(ctx, 'Сначала начните создание заново', true)
      return true
    }
    await answerGiveawayCallback(ctx)
    await askPrizeValue(ctx, adminId, prizeTypeMatch[1].toLowerCase())
    return true
  }

  const deliveredMatch = /^gw:delivered:([a-zA-Z0-9_-]{8,64})$/.exec(data)
  if (deliveredMatch) {
    const giveawayId = parseGiveawayId(deliveredMatch[1])
    if (!giveawayId) {
      await answerGiveawayCallback(ctx, 'Некорректный id', true)
      return true
    }
    const result = markPrizeDelivered(giveawayId)
    if (!result.success) {
      await answerGiveawayCallback(ctx, result.message || 'Ошибка', true)
      return true
    }
    await answerGiveawayCallback(ctx, result.alreadyDelivered ? 'Уже отмечено' : 'Отмечено')
    await replyHtml(
      ctx,
      [
        '✅ Приз отмечен как выданный.',
        '',
        `ID: <code>${escapeHtml(giveawayId)}</code>`,
        escapeHtml(formatDeliveryLine(result.giveaway)),
      ].join('\n'),
    )
    try {
      if (typeof ctx.editMessageReplyMarkup === 'function') {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] })
      }
    } catch {
      // Message may be too old to edit — ignore.
    }
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
      step: 'await_image',
      durationMs: preset.ms,
      durationLabel: preset.label,
      imageFileId: null,
    })
    await answerGiveawayCallback(ctx)
    await askImage(ctx, adminId)
    return true
  }

  if (data === 'gw:skip_image') {
    const wizard = getPendingGiveawayWizard(adminId)
    if (!wizard || wizard.step !== 'await_image') {
      await answerGiveawayCallback(ctx, 'Сначала начните создание заново', true)
      return true
    }
    setPendingGiveawayWizard(adminId, {
      step: 'await_confirm',
      imageFileId: null,
    })
    await answerGiveawayCallback(ctx)
    await showConfirm(ctx, adminId, {
      ...wizard,
      imageFileId: null,
    })
    return true
  }

  if (data === 'gw:confirm') {
    const wizard = getPendingGiveawayWizard(adminId)
    const prizeReady =
      wizard &&
      ((wizard.prizeType === 'coins' && wizard.prizeAmount) ||
        (wizard.prizeType === 'custom' && wizard.prizeText))
    if (
      !wizard ||
      wizard.step !== 'await_confirm' ||
      !prizeReady ||
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
  if (
    !wizard ||
    wizard.step === 'idle' ||
    wizard.step === 'await_confirm' ||
    wizard.step === 'await_prize_type'
  ) {
    return false
  }

  if (!isAdminTelegramUser(adminId)) {
    clearPendingGiveawayWizard(adminId)
    return false
  }

  if (wizard.step === 'await_image') {
    await replyHtml(
      ctx,
      '❌ Пожалуйста, отправьте именно изображение или нажмите «⏭ Пропустить».',
      { reply_markup: buildGiveawayImageKeyboard() },
    )
    return true
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
    if (wizard.prizeType === 'coins') {
      const parsed = parsePrizeAmountInput(text)
      if (!parsed.ok) {
        await replyHtml(ctx, `⚠ ${escapeHtml(parsed.message)}`)
        return true
      }
      setPendingGiveawayWizard(adminId, {
        step: 'await_winners',
        prizeAmount: parsed.value,
        prizeText: null,
      })
    } else {
      const parsed = parseCustomPrizeInput(text)
      if (!parsed.ok) {
        await replyHtml(ctx, `⚠ ${escapeHtml(parsed.message)}`)
        return true
      }
      setPendingGiveawayWizard(adminId, {
        step: 'await_winners',
        prizeAmount: null,
        prizeText: parsed.value,
      })
    }
    await askWinners(ctx)
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
      step: 'await_image',
      durationMs: duration.ms,
      durationLabel: duration.label,
      imageFileId: null,
    })
    await askImage(ctx, adminId)
    return true
  }

  return false
}

/**
 * Consume photo for giveaway create wizard. Returns true if handled.
 */
export async function handleGiveawayWizardPhoto(ctx) {
  const adminId = ctx.from?.id
  if (!adminId) {
    return false
  }

  const wizard = getPendingGiveawayWizard(adminId)
  if (!wizard || wizard.step !== 'await_image') {
    return false
  }

  if (!isAdminTelegramUser(adminId)) {
    clearPendingGiveawayWizard(adminId)
    return false
  }

  const fileId = extractLargestPhotoFileId(ctx.message)
  if (!fileId) {
    await replyHtml(
      ctx,
      '❌ Пожалуйста, отправьте именно изображение или нажмите «⏭ Пропустить».',
      { reply_markup: buildGiveawayImageKeyboard() },
    )
    return true
  }

  setPendingGiveawayWizard(adminId, {
    step: 'await_confirm',
    imageFileId: fileId,
  })
  await showConfirm(ctx, adminId, {
    ...wizard,
    imageFileId: fileId,
  })
  return true
}

/**
 * Reject non-photo media while waiting for giveaway image.
 */
export async function handleGiveawayWizardNonPhotoMedia(ctx) {
  const adminId = ctx.from?.id
  if (!adminId) {
    return false
  }

  const wizard = getPendingGiveawayWizard(adminId)
  if (!wizard || wizard.step !== 'await_image') {
    return false
  }

  if (!isAdminTelegramUser(adminId)) {
    clearPendingGiveawayWizard(adminId)
    return false
  }

  await replyHtml(
    ctx,
    '❌ Пожалуйста, отправьте именно изображение или нажмите «⏭ Пропустить».',
    { reply_markup: buildGiveawayImageKeyboard() },
  )
  return true
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
