import {
  answerTelegramCallback,
  getAdminNotifyChatIds,
  getAdminTelegramIds,
  isAdminTelegramUser,
  sendTelegramMessage,
  sendTelegramPhoto,
} from './telegram-notify.mjs'
import {
  approveCommunityAccess,
  getAdminCommunityRequest,
  getCommunityScreenshot,
  listAdminCommunityAccess,
  rejectCommunityAccess,
} from './community-access.mjs'
import { resolveCommunityScreenshotPath } from './uploads.mjs'

/** Admin awaiting rejection reason text. Keys are string telegram user ids. */
const pendingRejectByAdmin = new Map()
const REJECT_REASON_TTL_MS = 15 * 60 * 1000

export function clearPendingCommunityRejectReasons() {
  pendingRejectByAdmin.clear()
}

export function getPendingCommunityRejectReason(adminId) {
  const key = String(adminId ?? '').trim()
  const entry = pendingRejectByAdmin.get(key)
  if (!entry) {
    return null
  }
  if (entry.expiresAt < Date.now()) {
    pendingRejectByAdmin.delete(key)
    return null
  }
  return entry
}

function setPendingRejectReason(adminId, requestId) {
  pendingRejectByAdmin.set(String(adminId), {
    requestId: String(requestId),
    expiresAt: Date.now() + REJECT_REASON_TTL_MS,
  })
}

function clearPendingRejectReason(adminId) {
  pendingRejectByAdmin.delete(String(adminId))
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

export function buildCommunityModerationKeyboard(requestId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Одобрить', callback_data: `ca:approve:${requestId}` },
        { text: '❌ Отклонить', callback_data: `ca:reject:${requestId}` },
      ],
    ],
  }
}

export function buildCommunityResultKeyboard(label) {
  return {
    inline_keyboard: [[{ text: label, callback_data: 'ca:noop' }]],
  }
}

export function buildCommunityAdminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⏳ Ожидают проверки', callback_data: 'ca:pending' }],
      [{ text: '📜 История', callback_data: 'ca:history' }],
      [{ text: '◀️ Назад', callback_data: 'admin:root' }],
    ],
  }
}

export function buildAdminRootKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🎁 Розыгрыши', callback_data: 'gw:menu' }],
      [{ text: '🔒 Заявки на доступ', callback_data: 'ca:menu' }],
    ],
  }
}

export function parseCommunityModerationCallback(data) {
  const raw = String(data || '').trim()
  if (raw === 'ca:noop') {
    return { action: 'noop', requestId: null }
  }
  if (raw === 'ca:menu' || raw === 'ca:pending' || raw === 'ca:history') {
    return { action: raw.slice(3), requestId: null }
  }
  const match = /^ca:(approve|reject):([0-9a-fA-F-]{8,64})$/i.exec(raw)
  if (!match) {
    return null
  }
  return {
    action: match[1].toLowerCase(),
    requestId: match[2],
  }
}

export function buildCommunityRequestAdminText(request) {
  const username = request.username ? `@${escapeHtml(request.username)}` : 'отсутствует'
  const firstName = request.firstName ? escapeHtml(request.firstName) : '—'
  const welvuraId = request.welvuraId ? escapeHtml(request.welvuraId) : '—'
  return [
    '🔒 <b>Новая заявка на доступ</b>',
    '',
    `👤 Пользователь: ${username}`,
    `🪪 Имя: ${firstName}`,
    `🎮 Welvura ID: <code>${welvuraId}</code>`,
    `🆔 Telegram ID: <code>${request.telegramId}</code>`,
    `📅 Дата: ${escapeHtml(formatDateRu(request.createdAt))}`,
    '',
    'Статус: ⏳ Ожидает проверки',
    `ID заявки: <code>${escapeHtml(request.id)}</code>`,
  ].join('\n')
}

export async function answerCommunityCallback(ctx, text = '', showAlert = false) {
  const payload = String(text || '').slice(0, 200)
  try {
    if (typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery(payload, { show_alert: showAlert })
      return true
    }
  } catch {
    // fall through
  }
  const callbackId = ctx.callbackQuery?.id
  if (!callbackId) {
    return false
  }
  const result = await answerTelegramCallback(callbackId, payload, { showAlert })
  return Boolean(result.ok)
}

async function markModerationResult(ctx, label) {
  const markup = buildCommunityResultKeyboard(label)
  try {
    if (typeof ctx.editMessageReplyMarkup === 'function') {
      await ctx.editMessageReplyMarkup(markup)
      return
    }
  } catch {
    // best-effort
  }
}

async function replyHtml(ctx, text, extra = {}) {
  return ctx.reply(text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  })
}

async function requireAdminCtx(ctx) {
  const adminId = ctx.from?.id
  if (!isAdminTelegramUser(adminId)) {
    if (ctx.callbackQuery) {
      await answerCommunityCallback(ctx, '⛔ Недостаточно прав', true)
    } else if (typeof ctx.reply === 'function') {
      await ctx.reply('⛔ Недостаточно прав.')
    }
    return null
  }
  return String(adminId)
}

export async function sendAdminRootMenu(ctx) {
  const adminId = await requireAdminCtx(ctx)
  if (!adminId) {
    return true
  }
  await replyHtml(
    ctx,
    ['🛠 <b>Админ-меню</b>', '', 'Выберите раздел:'].join('\n'),
    { reply_markup: buildAdminRootKeyboard() },
  )
  return true
}

export async function sendCommunityAdminMenu(ctx) {
  const adminId = await requireAdminCtx(ctx)
  if (!adminId) {
    return true
  }
  await replyHtml(
    ctx,
    ['🔒 <b>Заявки на доступ</b>', '', 'Выберите действие:'].join('\n'),
    { reply_markup: buildCommunityAdminMenuKeyboard() },
  )
  return true
}

function formatRequestBlock(request) {
  const username = request.username ? `@${request.username}` : 'отсутствует'
  const statusLabel =
    request.status === 'approved'
      ? '✅ Одобрена'
      : request.status === 'rejected'
        ? '❌ Отклонена'
        : '⏳ На проверке'
  return [
    `🔒 Заявка <code>${escapeHtml(request.id)}</code>`,
    '',
    `👤 ${escapeHtml(username)}`,
    `🪪 ${escapeHtml(request.firstName || '—')}`,
    `🎮 Welvura ID: <code>${escapeHtml(request.welvuraId || '—')}</code>`,
    `🆔 TG: <code>${request.telegramId}</code>`,
    `📅 ${escapeHtml(formatDateRu(request.createdAt))}`,
    `Статус: ${statusLabel}`,
  ].join('\n')
}

async function showPendingList(ctx) {
  const listed = listAdminCommunityAccess('pending')
  const rows = listed.requests || []
  if (rows.length === 0) {
    await replyHtml(ctx, '⏳ Нет заявок на проверке.', {
      reply_markup: buildCommunityAdminMenuKeyboard(),
    })
    return
  }

  for (const request of rows.slice(0, 8)) {
    const text = formatRequestBlock(request)
    let absolutePath = null
    if (request.screenshotPath) {
      absolutePath = resolveCommunityScreenshotPath(request.screenshotPath)
    }
    if (!absolutePath) {
      const shot = getCommunityScreenshot(request.id, { isAdmin: true })
      absolutePath = shot.success ? shot.absolutePath : null
    }
    const keyboard = buildCommunityModerationKeyboard(request.id)
    if (absolutePath) {
      const photo = await sendTelegramPhoto(
        String(ctx.chat?.id || ctx.from?.id),
        absolutePath,
        text,
        { reply_markup: keyboard },
      )
      if (photo.ok) {
        continue
      }
    }
    await replyHtml(ctx, text, { reply_markup: keyboard })
  }
}

async function showHistoryList(ctx) {
  const listed = listAdminCommunityAccess('')
  const rows = (listed.requests || [])
    .filter((item) => item.status === 'approved' || item.status === 'rejected')
    .slice(0, 10)
  if (rows.length === 0) {
    await replyHtml(ctx, '📜 История пока пуста.', {
      reply_markup: buildCommunityAdminMenuKeyboard(),
    })
    return
  }
  const chunks = rows.map(formatRequestBlock)
  await replyHtml(ctx, ['📜 <b>История заявок</b>', '', ...chunks].join('\n\n'), {
    reply_markup: buildCommunityAdminMenuKeyboard(),
  })
}

/**
 * Notify admins with screenshot + approve/reject.
 */
export async function notifyAdminsNewCommunityAccess(request, options = {}) {
  const chatIds = getAdminNotifyChatIds()
  if (!chatIds.length) {
    console.warn('[community-admin] ADMIN_TELEGRAM_IDS / ADMIN_CHAT_ID not set — skip notify')
    return { ok: false, reason: 'admin_not_configured' }
  }

  if (!getAdminTelegramIds().length) {
    console.warn('[community-admin] ADMIN_TELEGRAM_IDS empty — moderation buttons will be denied')
  }

  const text = buildCommunityRequestAdminText(request)
  const keyboard = buildCommunityModerationKeyboard(request.id)

  let absolutePath = options.absolutePath || null
  if (!absolutePath && request.screenshotPath) {
    absolutePath = resolveCommunityScreenshotPath(request.screenshotPath)
  }
  if (!absolutePath) {
    const shot = getCommunityScreenshot(request.id, { isAdmin: true })
    absolutePath = shot.success ? shot.absolutePath : null
  }

  const results = []
  for (const chatId of chatIds) {
    if (absolutePath) {
      const photo = await sendTelegramPhoto(
        chatId,
        absolutePath,
        text,
        { reply_markup: keyboard },
        options,
      )
      results.push({ chatId, ...photo })
      if (photo.ok) {
        continue
      }
    }

    const message = await sendTelegramMessage(
      chatId,
      absolutePath
        ? `${text}\n\n⚠ Не удалось прикрепить скриншот.`
        : text,
      { reply_markup: keyboard },
      options,
    )
    results.push({ chatId, ...message })
  }

  const ok = results.some((item) => item.ok)
  console.info('[community-admin] request_notified', {
    requestId: request.id,
    ok,
    chats: results.length,
  })
  return { ok, results }
}

export async function notifyUserCommunityDecision(request, options = {}) {
  const chatId = String(request?.telegramId ?? '').trim()
  if (!/^-?\d+$/.test(chatId)) {
    return { ok: false, reason: 'missing_user' }
  }

  const status = String(request.status || '').toLowerCase()
  let text
  if (status === 'approved') {
    text = [
      '✅ <b>Доступ одобрен</b>',
      '',
      'Ваша заявка в закрытое сообщество подтверждена.',
      'Администрация свяжется с вами для выдачи доступа.',
    ].join('\n')
  } else if (status === 'rejected') {
    text = [
      '❌ <b>Заявка отклонена</b>',
      '',
      `Причина: ${escapeHtml(request.rejectionReason || 'Заявка отклонена.')}`,
      '',
      'Вы можете подать новую заявку.',
    ].join('\n')
  } else {
    return { ok: false, reason: 'not_final' }
  }

  return sendTelegramMessage(chatId, text, {}, options)
}

/**
 * Handle community admin callbacks. Returns true if handled.
 */
export async function handleCommunityAdminCallback(ctx) {
  const data = String(ctx.callbackQuery?.data || '').trim()
  if (data === 'admin:root') {
    await answerCommunityCallback(ctx)
    await sendAdminRootMenu(ctx)
    return true
  }

  if (!data.startsWith('ca:')) {
    return false
  }

  const adminId = await requireAdminCtx(ctx)
  if (!adminId) {
    return true
  }

  const parsed = parseCommunityModerationCallback(data)
  if (!parsed) {
    await answerCommunityCallback(ctx)
    return true
  }

  if (parsed.action === 'noop') {
    await answerCommunityCallback(ctx)
    return true
  }

  if (parsed.action === 'menu') {
    await answerCommunityCallback(ctx)
    await sendCommunityAdminMenu(ctx)
    return true
  }

  if (parsed.action === 'pending') {
    await answerCommunityCallback(ctx)
    await showPendingList(ctx)
    return true
  }

  if (parsed.action === 'history') {
    await answerCommunityCallback(ctx)
    await showHistoryList(ctx)
    return true
  }

  if (parsed.action === 'approve') {
    const result = approveCommunityAccess(parsed.requestId, `tg:${adminId}`)
    if (!result.success) {
      await answerCommunityCallback(ctx, result.message || 'Ошибка', true)
      return true
    }
    await answerCommunityCallback(ctx, result.alreadyReviewed ? 'Уже одобрено' : '✅ Одобрено')
    await markModerationResult(ctx, '✅ APPROVED')
    try {
      await notifyUserCommunityDecision(result.request)
    } catch {
      // best-effort
    }
    await replyHtml(
      ctx,
      `✅ Заявка <code>${escapeHtml(parsed.requestId)}</code> одобрена.`,
    )
    return true
  }

  if (parsed.action === 'reject') {
    setPendingRejectReason(adminId, parsed.requestId)
    await answerCommunityCallback(ctx, 'Укажите причину')
    await replyHtml(
      ctx,
      [
        '❌ Укажите причину отклонения заявки текстом.',
        '',
        'Для отмены напишите: <code>отмена</code>',
      ].join('\n'),
    )
    return true
  }

  await answerCommunityCallback(ctx)
  return true
}

/**
 * Consume reject-reason text for community access. Returns true if handled.
 */
export async function handleCommunityRejectReasonMessage(ctx) {
  const adminId = ctx.from?.id
  if (!adminId || !isAdminTelegramUser(adminId)) {
    return false
  }

  const pending = getPendingCommunityRejectReason(adminId)
  if (!pending) {
    return false
  }

  const text = String(ctx.message?.text || '').trim()
  const lower = text.toLowerCase()
  if (lower === 'отмена' || lower === 'cancel') {
    clearPendingRejectReason(adminId)
    await replyHtml(ctx, 'Отклонение отменено.')
    return true
  }

  const result = rejectCommunityAccess(pending.requestId, `tg:${adminId}`, text)
  clearPendingRejectReason(adminId)

  if (!result.success) {
    await replyHtml(ctx, `⚠ ${escapeHtml(result.message || 'Ошибка')}`)
    return true
  }

  try {
    await notifyUserCommunityDecision(result.request)
  } catch {
    // best-effort
  }

  await replyHtml(
    ctx,
    `❌ Заявка <code>${escapeHtml(pending.requestId)}</code> отклонена.`,
  )
  return true
}

export async function handleCommunityAdminCommand(ctx) {
  return sendAdminRootMenu(ctx)
}

/** Resolve full request for notify after create (includes screenshot path). */
export function loadCommunityRequestForNotify(requestId) {
  const result = getAdminCommunityRequest(requestId)
  return result.success ? result.request : null
}
