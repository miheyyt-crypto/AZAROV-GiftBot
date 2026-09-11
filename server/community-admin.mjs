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
import {
  isMaintenanceMode,
  toggleMaintenanceMode,
} from './maintenance.mjs'
import { getOnlineCount, listOnlineUsers } from './presence.mjs'
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

function setPendingRejectReason(adminId, requestId, messageRef = null) {
  pendingRejectByAdmin.set(String(adminId), {
    requestId: String(requestId),
    chatId: messageRef?.chatId ?? null,
    messageId: messageRef?.messageId ?? null,
    expiresAt: Date.now() + REJECT_REASON_TTL_MS,
  })
}

function clearPendingRejectReason(adminId) {
  pendingRejectByAdmin.delete(String(adminId))
}

function getCallbackMessageRef(ctx) {
  const chatId = ctx.callbackQuery?.message?.chat?.id
  const messageId = ctx.callbackQuery?.message?.message_id
  if (chatId == null || messageId == null) {
    return null
  }
  return { chatId, messageId }
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

const COMMUNITY_APPROVED_LABEL = '✅ Approved'
const COMMUNITY_REJECTED_LABEL = '❌ Rejected'
const COMMUNITY_WAITING_REASON_LABEL = '⏳ Укажите причину…'

export function buildCommunityAdminMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⏳ Ожидают проверки', callback_data: 'ca:pending' }],
      [{ text: '📜 История', callback_data: 'ca:history' }],
      [{ text: '◀️ Назад', callback_data: 'admin:root' }],
    ],
  }
}

export function buildAdminRootKeyboard(options = {}) {
  const maintenanceOn = Boolean(options.maintenanceMode)
  return {
    inline_keyboard: [
      [{ text: '🟢 Онлайн', callback_data: 'admin:online' }],
      [{ text: '🎁 Розыгрыши', callback_data: 'gw:menu' }],
      [{ text: '🔒 Заявки на доступ', callback_data: 'ca:menu' }],
      [{ text: '🎟 Промокоды', callback_data: 'promo:menu' }],
      [{ text: '📢 Рассылка', callback_data: 'bc:menu' }],
      [
        {
          text: maintenanceOn ? '🛠 Тех. перерыв: ВКЛ' : '🛠 Тех. перерыв: ВЫКЛ',
          callback_data: 'admin:maintenance',
        },
      ],
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

async function editCommunityReplyMarkup(ctx, markup, messageRef = null) {
  const chatId = messageRef?.chatId ?? ctx.callbackQuery?.message?.chat?.id
  const messageId = messageRef?.messageId ?? ctx.callbackQuery?.message?.message_id

  if (chatId != null && messageId != null && typeof ctx.telegram?.editMessageReplyMarkup === 'function') {
    try {
      await ctx.telegram.editMessageReplyMarkup(chatId, messageId, undefined, markup)
      return true
    } catch {
      // fall through
    }
  }

  if (!messageRef && typeof ctx.editMessageReplyMarkup === 'function') {
    try {
      await ctx.editMessageReplyMarkup(markup)
      return true
    } catch {
      // best-effort
    }
  }

  return false
}

async function markModerationResult(ctx, label, messageRef = null) {
  await editCommunityReplyMarkup(ctx, buildCommunityResultKeyboard(label), messageRef)
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
  const online = getOnlineCount()
  const maintenanceMode = isMaintenanceMode()
  await replyHtml(
    ctx,
    [
      '🛠 <b>Админ-меню</b>',
      '',
      `🟢 Онлайн в Mini App: <b>${online}</b>`,
      `🛠 Тех. перерыв: <b>${maintenanceMode ? 'ВКЛ' : 'ВЫКЛ'}</b>`,
      '',
      'Выберите раздел:',
    ].join('\n'),
    { reply_markup: buildAdminRootKeyboard({ maintenanceMode }) },
  )
  return true
}

export async function sendAdminOnlineStats(ctx) {
  const adminId = await requireAdminCtx(ctx)
  if (!adminId) {
    return true
  }
  const online = listOnlineUsers()
  const lines = [
    '🟢 <b>Онлайн в Mini App</b>',
    '',
    `Сейчас: <b>${online.length}</b>`,
    '',
  ]
  if (!online.length) {
    lines.push('Никого нет в приложении.')
  } else {
    const preview = online.slice(0, 30)
    for (const user of preview) {
      const name = user.username
        ? `@${escapeHtml(user.username)}`
        : escapeHtml(user.firstName || 'без имени')
      lines.push(`• ${name} — <code>${user.telegramId}</code>`)
    }
    if (online.length > preview.length) {
      lines.push('', `…и ещё ${online.length - preview.length}`)
    }
  }
  lines.push('', 'Обновляется по heartbeat из Mini App (~1.5 мин).')
  await replyHtml(ctx, lines.join('\n'), {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Обновить', callback_data: 'admin:online' }],
        [{ text: '◀️ Назад', callback_data: 'admin:root' }],
      ],
    },
  })
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

  if (data === 'admin:online') {
    await answerCommunityCallback(ctx)
    await sendAdminOnlineStats(ctx)
    return true
  }

  if (data === 'admin:maintenance') {
    const adminId = await requireAdminCtx(ctx)
    if (!adminId) {
      return true
    }
    const result = toggleMaintenanceMode()
    const on = Boolean(result.maintenanceMode)
    await answerCommunityCallback(
      ctx,
      on ? 'Тех. перерыв включён' : 'Тех. перерыв выключен',
      true,
    )
    await replyHtml(
      ctx,
      on
        ? '🛠 <b>Тех. перерыв ВКЛ</b>\n\nВ Mini App могут зайти только админы.\nОстальным показывается: «Ведутся тех. работы».'
        : '🛠 <b>Тех. перерыв ВЫКЛ</b>\n\nMini App снова доступен всем пользователям.',
      { reply_markup: buildAdminRootKeyboard({ maintenanceMode: on }) },
    )
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
    await markModerationResult(ctx, COMMUNITY_APPROVED_LABEL)
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
    const messageRef = getCallbackMessageRef(ctx)
    setPendingRejectReason(adminId, parsed.requestId, messageRef)
    await answerCommunityCallback(ctx, 'Укажите причину')
    if (messageRef) {
      await editCommunityReplyMarkup(
        ctx,
        buildCommunityResultKeyboard(COMMUNITY_WAITING_REASON_LABEL),
        messageRef,
      )
    }
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
  const messageRef =
    pending.chatId != null && pending.messageId != null
      ? { chatId: pending.chatId, messageId: pending.messageId }
      : null

  if (lower === 'отмена' || lower === 'cancel') {
    clearPendingRejectReason(adminId)
    if (messageRef) {
      await editCommunityReplyMarkup(
        ctx,
        buildCommunityModerationKeyboard(pending.requestId),
        messageRef,
      )
    }
    await replyHtml(ctx, 'Отклонение отменено.')
    return true
  }

  const result = rejectCommunityAccess(pending.requestId, `tg:${adminId}`, text)
  clearPendingRejectReason(adminId)

  if (!result.success) {
    const status = String(result?.request?.status || '').toLowerCase()
    if (messageRef) {
      if (status === 'approved') {
        await markModerationResult(ctx, COMMUNITY_APPROVED_LABEL, messageRef)
      } else if (status === 'rejected') {
        await markModerationResult(ctx, COMMUNITY_REJECTED_LABEL, messageRef)
      } else {
        await editCommunityReplyMarkup(
          ctx,
          buildCommunityModerationKeyboard(pending.requestId),
          messageRef,
        )
      }
    }
    await replyHtml(ctx, `⚠ ${escapeHtml(result.message || 'Ошибка')}`)
    return true
  }

  await markModerationResult(ctx, COMMUNITY_REJECTED_LABEL, messageRef)

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
