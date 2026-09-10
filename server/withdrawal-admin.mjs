import {
  answerTelegramCallback,
  getAdminNotifyChatIds,
  isAdminTelegramUser,
  sendTelegramMessage,
} from './telegram-notify.mjs'
import { getUser } from './store.mjs'
import {
  approveWithdrawal,
  rejectWithdrawal,
  WITHDRAWAL_STATUS,
} from './withdrawals.mjs'

export function buildWithdrawalModerationKeyboard(withdrawalId) {
  const id = String(withdrawalId || '').toUpperCase()
  return {
    inline_keyboard: [
      [
        { text: '✅ Выплачено', callback_data: `wd:approve:${id}` },
        { text: '❌ Отклонить', callback_data: `wd:reject:${id}` },
      ],
    ],
  }
}

export function buildWithdrawalResultKeyboard(label) {
  return {
    inline_keyboard: [[{ text: label, callback_data: 'wd:noop' }]],
  }
}

export function parseWithdrawalModerationCallback(data) {
  const raw = String(data || '').trim()
  if (raw === 'wd:noop') {
    return { action: 'noop', withdrawalId: null }
  }
  const match = /^wd:(approve|reject):(WD-[A-Z0-9]{4,16})$/i.exec(raw)
  if (!match) {
    return null
  }
  return {
    action: match[1].toLowerCase(),
    withdrawalId: match[2].toUpperCase(),
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

function formatAmount(amount) {
  return `${Number(amount || 0).toLocaleString('ru-RU')} ₽`
}

export function buildWithdrawalAdminText(withdrawal, user) {
  const username = user?.username ? `@${escapeHtml(user.username)}` : '—'
  return [
    '━━━━━━━━━━━━━━━━',
    '💸 <b>НОВЫЙ ВЫВОД</b>',
    '━━━━━━━━━━━━━━━━',
    '',
    `👤 Пользователь: ${username}`,
    `🆔 ID: <code>${withdrawal.userId}</code>`,
    '',
    `💰 Сумма: <b>${escapeHtml(formatAmount(withdrawal.amountRub))}</b>`,
    '💎 Метод: Welvura',
    '',
    '🎮 Welvura ID:',
    `<code>${escapeHtml(withdrawal.welvuraId || withdrawal.walletAddress)}</code>`,
    '',
    `🎁 Предмет: ${escapeHtml(withdrawal.itemName || formatAmount(withdrawal.amountRub))}`,
    `🆔 Item: <code>${escapeHtml(withdrawal.itemId)}</code>`,
    '',
    `📋 Заявка: <code>${escapeHtml(withdrawal.id)}</code>`,
    '',
    `🕐 ${escapeHtml(formatDateRu(withdrawal.createdAt))}`,
    '',
    '🟡 ОЖИДАЕТ ОБРАБОТКИ',
    '━━━━━━━━━━━━━━━━',
  ].join('\n')
}

export async function answerWithdrawalCallback(ctx, text = '', showAlert = false) {
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

async function markWithdrawalModerationResult(ctx, label) {
  const markup = buildWithdrawalResultKeyboard(label)
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

export async function notifyAdminsNewWithdrawal(withdrawal, options = {}) {
  const chatIds = getAdminNotifyChatIds()
  if (!chatIds.length) {
    console.warn('[withdrawal-admin] ADMIN_TELEGRAM_IDS / ADMIN_CHAT_ID not set — skip notify')
    return { ok: false, reason: 'admin_not_configured' }
  }

  const user = getUser(withdrawal.userId)
  const text = buildWithdrawalAdminText(withdrawal, user)
  const keyboard = buildWithdrawalModerationKeyboard(withdrawal.id)

  const results = []
  for (const chatId of chatIds) {
    const message = await sendTelegramMessage(chatId, text, { reply_markup: keyboard }, options)
    results.push({ chatId, ...message })
  }

  const ok = results.some((item) => item.ok)
  console.info('[withdrawal-admin] notified', {
    withdrawalId: withdrawal.id,
    ok,
    chats: results.length,
  })
  return { ok, results }
}

export async function notifyUserWithdrawalDecision(withdrawal, options = {}) {
  const chatId = String(withdrawal?.userId ?? '').trim()
  if (!/^-?\d+$/.test(chatId)) {
    return { ok: false, reason: 'missing_user' }
  }

  const status = String(withdrawal.status || '').toUpperCase()
  const amount = formatAmount(withdrawal.amountRub)
  let text

  if (status === WITHDRAWAL_STATUS.PAID) {
    text = [
      '✅ <b>Выплата подтверждена!</b>',
      '',
      escapeHtml(amount),
      'на баланс Welvura',
      '',
      `Заявка <code>${escapeHtml(withdrawal.id)}</code>`,
    ].join('\n')
  } else if (status === WITHDRAWAL_STATUS.REJECTED) {
    text = [
      '❌ <b>Заявка на вывод отклонена.</b>',
      '',
      `Заявка <code>${escapeHtml(withdrawal.id)}</code>`,
      '',
      'Предмет возвращён в инвентарь.',
    ].join('\n')
  } else {
    return { ok: false, reason: 'not_final' }
  }

  return sendTelegramMessage(chatId, text, {}, options)
}

export async function handleWithdrawalModerationCallback(ctx) {
  const data = String(ctx.callbackQuery?.data || ctx.match?.input || '').trim()
  const parsed = parseWithdrawalModerationCallback(data)
  if (!parsed) {
    return false
  }

  const adminId = ctx.from?.id ?? ctx.callbackQuery?.from?.id
  if (parsed.action === 'noop') {
    await answerWithdrawalCallback(ctx)
    return true
  }

  if (!isAdminTelegramUser(adminId)) {
    await answerWithdrawalCallback(ctx, 'Нет доступа', true)
    return true
  }

  if (parsed.action === 'approve') {
    const result = approveWithdrawal(parsed.withdrawalId, adminId)
    if (!result.success) {
      await answerWithdrawalCallback(ctx, result.message || 'Ошибка', true)
      return true
    }

    await answerWithdrawalCallback(ctx, result.alreadyProcessed ? 'Уже выплачено' : 'Выплачено')
    await markWithdrawalModerationResult(ctx, '🟢 Выплачено')

    if (!result.alreadyProcessed) {
      const w = result.withdrawal
      await ctx.reply(
        [
          '✅ Выплата подтверждена',
          '',
          `Заявка <code>${escapeHtml(w.id)}</code>`,
          '',
          `Сумма: ${escapeHtml(formatAmount(w.amountRub))}`,
          '',
          'Статус: 🟢 Выплачено',
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
      void notifyUserWithdrawalDecision(w).catch(() => {})
    }
    return true
  }

  if (parsed.action === 'reject') {
    const result = rejectWithdrawal(parsed.withdrawalId, adminId)
    if (!result.success) {
      await answerWithdrawalCallback(ctx, result.message || 'Ошибка', true)
      return true
    }

    await answerWithdrawalCallback(ctx, result.alreadyProcessed ? 'Уже отклонено' : 'Отклонено')
    await markWithdrawalModerationResult(ctx, '🔴 Отклонена')

    if (!result.alreadyProcessed) {
      const w = result.withdrawal
      await ctx.reply(
        [
          '❌ Заявка отклонена',
          '',
          `Заявка <code>${escapeHtml(w.id)}</code>`,
          '',
          'Статус: 🔴 Отклонена',
        ].join('\n'),
        { parse_mode: 'HTML' },
      )
      void notifyUserWithdrawalDecision(w).catch(() => {})
    }
    return true
  }

  await answerWithdrawalCallback(ctx)
  return true
}
