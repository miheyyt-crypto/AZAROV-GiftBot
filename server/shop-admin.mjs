import {
  answerTelegramCallback,
  getAdminNotifyChatIds,
  getAdminTelegramIds,
  isAdminTelegramUser,
  sendTelegramMessage,
} from './telegram-notify.mjs'
import { approveShopOrder, isInventoryProduct, rejectShopOrder } from './shop.mjs'
import { getUser } from './store.mjs'

/** Admin awaiting shop rejection reason. Keys are string telegram user ids. */
const pendingShopRejectByAdmin = new Map()
const REJECT_REASON_TTL_MS = 15 * 60 * 1000

export function clearPendingShopRejectReasons() {
  pendingShopRejectByAdmin.clear()
}

export function getPendingShopRejectReason(adminId) {
  const key = String(adminId ?? '').trim()
  const entry = pendingShopRejectByAdmin.get(key)
  if (!entry) {
    return null
  }
  if (entry.expiresAt < Date.now()) {
    pendingShopRejectByAdmin.delete(key)
    return null
  }
  return entry
}

function setPendingShopRejectReason(adminId, orderId) {
  pendingShopRejectByAdmin.set(String(adminId), {
    orderId: String(orderId),
    expiresAt: Date.now() + REJECT_REASON_TTL_MS,
  })
}

function clearPendingShopRejectReason(adminId) {
  pendingShopRejectByAdmin.delete(String(adminId))
}

export function buildShopModerationKeyboard(orderId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Одобрить', callback_data: `shop:approve:${orderId}` },
        { text: '❌ Отклонить', callback_data: `shop:reject:${orderId}` },
      ],
    ],
  }
}

export function buildShopResultKeyboard(label) {
  return {
    inline_keyboard: [[{ text: label, callback_data: 'shop:noop' }]],
  }
}

export function parseShopModerationCallback(data) {
  const raw = String(data || '').trim()
  if (raw === 'shop:noop') {
    return { action: 'noop', orderId: null }
  }
  const match = /^shop:(approve|reject):([A-Z0-9]{4,32})$/i.exec(raw)
  if (!match) {
    return null
  }
  return {
    action: match[1].toLowerCase(),
    orderId: match[2].toUpperCase(),
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatDateRu(iso) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
  } catch {
    return String(iso || '')
  }
}

function formatMetadataLines(metadata) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  const lines = []
  if (meta.telegramUsername) {
    lines.push(`Telegram: <code>${escapeHtml(meta.telegramUsername)}</code>`)
  }
  if (meta.usdtAddress) {
    lines.push(`USDT TRC20: <code>${escapeHtml(meta.usdtAddress)}</code>`)
  }
  if (meta.kickUsername) {
    lines.push(`Kick: <code>${escapeHtml(meta.kickUsername)}</code>`)
  }
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'telegramUsername' || key === 'usdtAddress' || key === 'kickUsername') {
      continue
    }
    if (value == null || value === '') {
      continue
    }
    lines.push(`${escapeHtml(key)}: <code>${escapeHtml(value)}</code>`)
  }
  return lines
}

export function buildShopOrderAdminText(order, user) {
  const username = user?.username ? `@${escapeHtml(user.username)}` : '—'
  const metaLines = formatMetadataLines(order.metadata)
  const status = String(order.status || 'pending')
  return [
    '🛒 <b>НОВЫЙ ЗАКАЗ МАГАЗИНА</b>',
    '',
    `🎁 Товар: <b>${escapeHtml(order.productName)}</b>`,
    `🆔 productId: <code>${escapeHtml(order.productId)}</code>`,
    `💰 Стоимость: <b>${Number(order.price) || 0}</b> 🪙`,
    '',
    '👤 Пользователь:',
    `Telegram ID: <code>${order.userId ?? order.telegramUserId}</code>`,
    `Username: ${username}`,
    '',
    ...(metaLines.length
      ? ['📦 Данные для выдачи:', ...metaLines, '']
      : ['📦 Данные для выдачи: —', '']),
    `📅 Дата: ${escapeHtml(formatDateRu(order.createdAt))}`,
    `Статус: ${escapeHtml(status)}`,
    `ID заказа: <code>${escapeHtml(order.orderId)}</code>`,
  ].join('\n')
}

export async function answerShopCallback(ctx, text = '', showAlert = false) {
  const payload = String(text || '').slice(0, 200)
  try {
    if (typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery(payload, { show_alert: showAlert })
      return true
    }
  } catch (error) {
    console.warn('[shop-admin] ctx.answerCbQuery failed', {
      message: error instanceof Error ? error.message : 'unknown_error',
    })
  }

  const callbackId = ctx.callbackQuery?.id
  if (!callbackId) {
    return false
  }
  const result = await answerTelegramCallback(callbackId, payload, { showAlert })
  return Boolean(result.ok)
}

async function markShopModerationResult(ctx, label) {
  const markup = buildShopResultKeyboard(label)
  try {
    if (typeof ctx.editMessageReplyMarkup === 'function') {
      await ctx.editMessageReplyMarkup(markup)
      return
    }
  } catch {
    // fall through
  }

  try {
    const chatId = ctx.callbackQuery?.message?.chat?.id
    const messageId = ctx.callbackQuery?.message?.message_id
    if (chatId != null && messageId != null && typeof ctx.telegram?.editMessageReplyMarkup === 'function') {
      await ctx.telegram.editMessageReplyMarkup(chatId, messageId, undefined, markup)
    }
  } catch {
    // Best-effort
  }
}

export async function notifyAdminsNewShopOrder(order, options = {}) {
  const chatIds = getAdminNotifyChatIds()
  if (!chatIds.length) {
    console.warn('[shop-admin] ADMIN_TELEGRAM_IDS / ADMIN_CHAT_ID not set — skip notify')
    return { ok: false, reason: 'admin_not_configured' }
  }

  const user = getUser(order.userId ?? order.telegramUserId)
  const text = buildShopOrderAdminText(order, user)
  const keyboard = buildShopModerationKeyboard(order.orderId)

  const results = []
  for (const chatId of chatIds) {
    const message = await sendTelegramMessage(chatId, text, { reply_markup: keyboard }, options)
    results.push({ chatId, ...message })
  }

  const ok = results.some((item) => item.ok)
  console.info('[shop-admin] order_notified', {
    orderId: order.orderId,
    ok,
    chats: results.length,
  })
  return { ok, results }
}

export async function notifyUserShopDecision(order, options = {}) {
  const chatId = String(order?.userId ?? order?.telegramUserId ?? '').trim()
  if (!/^-?\d+$/.test(chatId)) {
    return { ok: false, reason: 'missing_user' }
  }

  const status = String(order.status || '').toLowerCase()
  const productName = escapeHtml(order.productName || order.productId || 'товар')
  let text

  if (status === 'completed') {
    if (isInventoryProduct(order.productId)) {
      text = [
        '🧊 <b>Заморозка стрика добавлена в ваш инвентарь.</b>',
        '',
        `Заказ <code>${escapeHtml(order.orderId)}</code> выполнен.`,
      ].join('\n')
    } else {
      text = [
        `✅ <b>Ваша заявка на ${productName} выполнена.</b>`,
        '',
        `Заказ <code>${escapeHtml(order.orderId)}</code>.`,
      ].join('\n')
    }
  } else if (status === 'rejected') {
    text = [
      '❌ <b>Ваша заявка отклонена. Монеты возвращены.</b>',
      '',
      `Товар: ${productName}`,
      `Причина: ${escapeHtml(order.rejectionReason || 'Заказ отклонён.')}`,
    ].join('\n')
  } else {
    return { ok: false, reason: 'not_final' }
  }

  const result = await sendTelegramMessage(chatId, text, {}, options)
  if (!result.ok) {
    console.warn('[shop-admin] user notify failed', {
      orderId: order?.orderId || null,
      status,
      error: result.error || null,
    })
  }
  return result
}

export async function handleShopModerationCallback(ctx) {
  const data = String(ctx.callbackQuery?.data || ctx.match?.input || '').trim()
  const parsed = parseShopModerationCallback(data)

  if (!parsed) {
    return false
  }

  const adminId = ctx.from?.id ?? ctx.callbackQuery?.from?.id
  console.info('[shop-admin] callback received', {
    action: parsed.action,
    orderId: parsed.orderId,
    adminId: adminId != null ? String(adminId) : null,
    adminConfigured: getAdminTelegramIds().length,
  })

  if (parsed.action === 'noop') {
    await answerShopCallback(ctx)
    return true
  }

  if (!isAdminTelegramUser(adminId)) {
    console.warn('[shop-admin] callback denied — not in ADMIN_TELEGRAM_IDS', {
      adminId: adminId != null ? String(adminId) : null,
    })
    await answerShopCallback(ctx, '⛔ Недостаточно прав', true)
    return true
  }

  if (parsed.action === 'approve') {
    let result
    try {
      result = approveShopOrder(
        parsed.orderId,
        `tg:${adminId}`,
        `tg-approve:${ctx.callbackQuery?.id || Date.now()}`,
      )
    } catch (error) {
      console.error('[shop-admin] approve threw', {
        orderId: parsed.orderId,
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      await answerShopCallback(ctx, 'Ошибка одобрения', true)
      return true
    }

    if (!result?.success) {
      await answerShopCallback(ctx, result?.message || 'Ошибка', true)
      return true
    }

    await answerShopCallback(ctx, '✅ Заказ одобрен')
    await markShopModerationResult(ctx, '✅ APPROVED')
    try {
      await notifyUserShopDecision(result.order)
    } catch (error) {
      console.error('[shop-admin] approve user notify threw', {
        orderId: parsed.orderId,
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
    try {
      await ctx.reply(
        `✅ Заказ <code>${escapeHtml(parsed.orderId)}</code> одобрен.\n${escapeHtml(result.message)}`,
        { parse_mode: 'HTML' },
      )
    } catch {
      // ignore
    }
    return true
  }

  // reject → ask for reason
  setPendingShopRejectReason(adminId, parsed.orderId)
  await answerShopCallback(ctx, 'Введите причину отклонения')
  try {
    await ctx.reply(
      [
        `❌ Отклонение заказа <code>${escapeHtml(parsed.orderId)}</code>.`,
        '',
        'Ответьте причиной отклонения или напишите в личку боту.',
        'Чтобы отменить ввод причины, напишите «отмена».',
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  } catch {
    // ignore
  }
  return true
}

export async function handleShopRejectReasonMessage(ctx) {
  const adminId = ctx.from?.id
  if (!isAdminTelegramUser(adminId)) {
    return false
  }

  const pending = getPendingShopRejectReason(adminId)
  if (!pending) {
    return false
  }

  const text = String(ctx.message?.text || '').trim()
  if (!text) {
    return false
  }

  if (/^(отмена|cancel)$/i.test(text)) {
    clearPendingShopRejectReason(adminId)
    await ctx.reply('Отклонение отменено. Заказ по-прежнему ожидает обработки.')
    return true
  }

  clearPendingShopRejectReason(adminId)
  let result
  try {
    result = rejectShopOrder(
      pending.orderId,
      `tg:${adminId}`,
      text,
      `tg-reject:${adminId}:${Date.now()}`,
    )
  } catch (error) {
    console.error('[shop-admin] reject threw', {
      orderId: pending.orderId,
      message: error instanceof Error ? error.message : 'unknown_error',
    })
    await ctx.reply('Не удалось отклонить заказ.')
    return true
  }

  if (!result?.success) {
    await ctx.reply(result?.message || 'Не удалось отклонить заказ.')
    return true
  }

  await markShopModerationResult(ctx, '❌ REJECTED')
  try {
    await notifyUserShopDecision(result.order)
  } catch (error) {
    console.error('[shop-admin] reject user notify threw', {
      orderId: pending.orderId,
      message: error instanceof Error ? error.message : 'unknown_error',
    })
  }
  await ctx.reply(
    `❌ Заказ <code>${escapeHtml(pending.orderId)}</code> отклонён.\nПричина: ${escapeHtml(text)}`,
    { parse_mode: 'HTML' },
  )
  return true
}

export { isAdminTelegramUser, getAdminTelegramIds }
