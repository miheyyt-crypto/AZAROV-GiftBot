import {
  answerTelegramCallback,
  getAdminNotifyChatIds,
  getAdminTelegramIds,
  isAdminTelegramUser,
  sendTelegramMessage,
  sendTelegramPhoto,
} from './telegram-notify.mjs'
import {
  approvePartnerSubmission,
  getSubmissionScreenshot,
  rejectPartnerSubmission,
} from './partner-submissions.mjs'
import { getUser } from './store.mjs'
import { resolveSubmissionScreenshotPath } from './uploads.mjs'

/** Admin awaiting rejection reason text. Keys are string telegram user ids. */
const pendingRejectByAdmin = new Map()

const REJECT_REASON_TTL_MS = 15 * 60 * 1000

export function clearPendingRejectReasons() {
  pendingRejectByAdmin.clear()
}

export function getPendingRejectReason(adminId) {
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

function setPendingRejectReason(adminId, submissionId, messageRef = null) {
  pendingRejectByAdmin.set(String(adminId), {
    submissionId: String(submissionId),
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

export function buildPartnerModerationKeyboard(submissionId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Подтвердить', callback_data: `vellur:approve:${submissionId}` },
        { text: '❌ Отклонить', callback_data: `vellur:reject:${submissionId}` },
      ],
    ],
  }
}

export function buildPartnerResultKeyboard(label) {
  return {
    inline_keyboard: [[{ text: label, callback_data: 'vellur:noop' }]],
  }
}

const PARTNER_APPROVED_LABEL = '✅ Approved'
const PARTNER_REJECTED_LABEL = '❌ Rejected'
const PARTNER_WAITING_REASON_LABEL = '⏳ Укажите причину…'

export function parsePartnerModerationCallback(data) {
  const raw = String(data || '').trim()
  if (raw === 'vellur:noop') {
    return { action: 'noop', submissionId: null }
  }
  const match = /^(vellur|welvura|partner):(approve|reject):([0-9a-fA-F-]{8,64})$/i.exec(raw)
  if (!match) {
    return null
  }
  return {
    action: match[2].toLowerCase(),
    submissionId: match[3],
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

export function buildPartnerSubmissionAdminText(submission, user) {
  const username = user?.username ? `@${escapeHtml(user.username)}` : '—'
  const partnerName = escapeHtml(submission.partnerName || 'Partner')
  const taskTitle = escapeHtml(submission.taskTitle || submission.taskId)
  return [
    `🆕 <b>НОВАЯ ЗАЯВКА ${partnerName.toUpperCase()}</b>`,
    '',
    `📋 Задание: ${taskTitle}`,
    `🎁 Награда: <b>${Number(submission.reward) || 0}</b> монет`,
    '',
    '👤 Пользователь:',
    `Telegram ID: <code>${submission.telegramUserId}</code>`,
    `Username: ${username}`,
    '',
    `🆔 ${partnerName} ID:`,
    `<code>${escapeHtml(submission.partnerAccountId)}</code>`,
    '',
    `📅 Дата: ${escapeHtml(formatDateRu(submission.createdAt))}`,
    '',
    'Статус: ⏳ Ожидает проверки',
    `ID заявки: <code>${escapeHtml(submission.submissionId)}</code>`,
  ].join('\n')
}

/**
 * Always clear Telegram's loading spinner. Prefer Telegraf ctx, fall back to Bot API.
 */
export async function answerPartnerCallback(ctx, text = '', showAlert = false) {
  const payload = String(text || '').slice(0, 200)
  try {
    if (typeof ctx.answerCbQuery === 'function') {
      await ctx.answerCbQuery(payload, { show_alert: showAlert })
      return true
    }
  } catch (error) {
    console.warn('[partner-admin] ctx.answerCbQuery failed', {
      message: error instanceof Error ? error.message : 'unknown_error',
    })
  }

  const callbackId = ctx.callbackQuery?.id
  if (!callbackId) {
    return false
  }
  const result = await answerTelegramCallback(callbackId, payload, { showAlert })
  if (!result.ok) {
    console.warn('[partner-admin] answerCallbackQuery failed', {
      error: result.error || null,
      description: result.description || null,
    })
  }
  return Boolean(result.ok)
}

async function editPartnerReplyMarkup(ctx, markup, messageRef = null) {
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

  // Only safe for callback ctx on the original moderation message (approve path).
  if (!messageRef && typeof ctx.editMessageReplyMarkup === 'function') {
    try {
      await ctx.editMessageReplyMarkup(markup)
      return true
    } catch {
      // Best-effort
    }
  }

  return false
}

async function markModerationResult(ctx, label, messageRef = null) {
  await editPartnerReplyMarkup(ctx, buildPartnerResultKeyboard(label), messageRef)
}

/**
 * Notify configured admin chats with caption + screenshot + approve/reject buttons.
 */
export async function notifyAdminsNewPartnerSubmission(submission, options = {}) {
  const chatIds = getAdminNotifyChatIds()
  if (!chatIds.length) {
    console.warn('[partner-admin] ADMIN_TELEGRAM_IDS / ADMIN_CHAT_ID not set — skip notify')
    return { ok: false, reason: 'admin_not_configured' }
  }

  if (!getAdminTelegramIds().length) {
    console.warn('[partner-admin] ADMIN_TELEGRAM_IDS empty — moderation buttons will be denied')
  }

  const user = getUser(submission.telegramUserId)
  const text = buildPartnerSubmissionAdminText(submission, user)
  const keyboard = buildPartnerModerationKeyboard(submission.submissionId)

  let absolutePath = null
  if (submission.screenshotPath) {
    absolutePath = resolveSubmissionScreenshotPath(submission.screenshotPath)
  }
  if (!absolutePath) {
    const shot = getSubmissionScreenshot(submission.submissionId, { isAdmin: true })
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
        ? `${text}\n\n⚠ Не удалось прикрепить скриншот — скачай через admin API.`
        : text,
      { reply_markup: keyboard },
      options,
    )
    results.push({ chatId, ...message })
  }

  const ok = results.some((item) => item.ok)
  console.info('[partner-admin] submission_notified', {
    submissionId: submission.submissionId,
    ok,
    chats: results.length,
  })
  return { ok, results }
}

export async function notifyUserPartnerDecision(submission, options = {}) {
  // Prefer string chat_id — avoids Number() precision issues on large Telegram IDs.
  const chatId = String(submission?.telegramUserId ?? '').trim()
  if (!/^-?\d+$/.test(chatId)) {
    console.warn('[partner-admin] user notify skipped — missing telegramUserId', {
      submissionId: submission?.submissionId || null,
      status: submission?.status || null,
    })
    return { ok: false, reason: 'missing_user' }
  }

  const partnerName = submission.partnerName || 'Partner'
  const status = String(submission.status || '').toLowerCase()
  let text
  if (status === 'approved') {
    const reward = Number(submission.reward) || 0
    text = [
      `✅ <b>${escapeHtml(partnerName)} подтверждён!</b>`,
      '',
      'Ваша заявка успешно проверена.',
      `🎁 Вам начислено <b>${reward}</b> монет.`,
    ].join('\n')
  } else if (status === 'rejected') {
    text = [
      `❌ <b>Ваша заявка ${escapeHtml(partnerName)} отклонена.</b>`,
      '',
      `Причина: ${escapeHtml(submission.rejectionReason || 'Заявка отклонена.')}`,
      '',
      'Вы можете исправить данные и подать заявку повторно.',
    ].join('\n')
  } else {
    console.warn('[partner-admin] user notify skipped — not final status', {
      submissionId: submission?.submissionId || null,
      status: submission?.status || null,
    })
    return { ok: false, reason: 'not_final' }
  }

  const result = await sendTelegramMessage(chatId, text, {}, options)
  if (!result.ok) {
    console.warn('[partner-admin] user notify failed', {
      submissionId: submission?.submissionId || null,
      status,
      chatId,
      error: result.error || null,
      description: result.description || null,
    })
  } else {
    console.info('[partner-admin] user notified', {
      submissionId: submission?.submissionId || null,
      status,
      chatId,
    })
  }
  return result
}

/**
 * Handle inline approve/reject callbacks from Telegram admins.
 */
export async function handlePartnerModerationCallback(ctx) {
  const data = String(ctx.callbackQuery?.data || ctx.match?.input || '').trim()
  const parsed = parsePartnerModerationCallback(data)

  if (!parsed) {
    console.info('[partner-admin] callback ignored (unmatched)', {
      data: data.slice(0, 80) || null,
    })
    return false
  }

  const adminId = ctx.from?.id ?? ctx.callbackQuery?.from?.id
  console.info('[partner-admin] callback received', {
    action: parsed.action,
    submissionId: parsed.submissionId,
    adminId: adminId != null ? String(adminId) : null,
    adminConfigured: getAdminTelegramIds().length,
  })

  if (parsed.action === 'noop') {
    await answerPartnerCallback(ctx)
    return true
  }

  if (!isAdminTelegramUser(adminId)) {
    console.warn('[partner-admin] callback denied — not in ADMIN_TELEGRAM_IDS', {
      adminId: adminId != null ? String(adminId) : null,
    })
    await answerPartnerCallback(ctx, '⛔ Недостаточно прав', true)
    return true
  }

  if (parsed.action === 'approve') {
    let result
    try {
      result = approvePartnerSubmission(
        parsed.submissionId,
        `tg:${adminId}`,
        `tg-approve:${ctx.callbackQuery?.id || Date.now()}`,
      )
    } catch (error) {
      console.error('[partner-admin] approve threw', {
        submissionId: parsed.submissionId,
        message: error instanceof Error ? error.message : 'unknown_error',
      })
      await answerPartnerCallback(ctx, 'Ошибка подтверждения', true)
      return true
    }

    console.info('[partner-admin] approve result', {
      submissionId: parsed.submissionId,
      success: Boolean(result?.success),
      status: result?.submission?.status || null,
      message: result?.message || null,
    })

    if (!result?.success) {
      await answerPartnerCallback(ctx, result?.message || 'Ошибка', true)
      return true
    }

    await answerPartnerCallback(ctx, '✅ Заявка подтверждена')
    await markModerationResult(ctx, PARTNER_APPROVED_LABEL)
    try {
      await notifyUserPartnerDecision(result.submission)
    } catch (error) {
      console.error('[partner-admin] approve user notify threw', {
        submissionId: parsed.submissionId,
        message: error instanceof Error ? error.message : 'unknown_error',
      })
    }
    try {
      await ctx.reply(
        `✅ Заявка <code>${escapeHtml(parsed.submissionId)}</code> подтверждена.\n${escapeHtml(result.message)}`,
        { parse_mode: 'HTML' },
      )
    } catch {
      // ignore
    }
    return true
  }

  // reject → ask for reason (does NOT reject yet; «отмена» cancels this step only)
  const messageRef = getCallbackMessageRef(ctx)
  setPendingRejectReason(adminId, parsed.submissionId, messageRef)
  await answerPartnerCallback(ctx, 'Введите причину отклонения')
  if (messageRef) {
    await editPartnerReplyMarkup(ctx, buildPartnerResultKeyboard(PARTNER_WAITING_REASON_LABEL), messageRef)
  }
  try {
    await ctx.reply(
      [
        `❌ Отклонение заявки <code>${escapeHtml(parsed.submissionId)}</code>.`,
        '',
        'Ответьте на это сообщение причиной отклонения',
        'или напишите причину в личку боту.',
        '',
        'Чтобы отменить ввод причины (заявка останется на проверке), напишите «отмена».',
      ].join('\n'),
      { parse_mode: 'HTML' },
    )
  } catch {
    // ignore
  }
  return true
}

/**
 * Consume admin text as rejection reason when awaiting.
 * «отмена» / «cancel» = abort reason entry only (submission stays pending).
 * Any other text (including «отменить») = final reject with that reason + user notify.
 * @returns {boolean} true if message was consumed
 */
export async function handlePartnerRejectReasonMessage(ctx) {
  const adminId = ctx.from?.id
  if (!isAdminTelegramUser(adminId)) {
    return false
  }

  const pending = getPendingRejectReason(adminId)
  if (!pending) {
    return false
  }

  const text = String(ctx.message?.text || '').trim()
  if (!text) {
    return false
  }

  if (/^(отмена|cancel)$/i.test(text)) {
    const messageRef =
      pending.chatId != null && pending.messageId != null
        ? { chatId: pending.chatId, messageId: pending.messageId }
        : null
    clearPendingRejectReason(adminId)
    if (messageRef) {
      await editPartnerReplyMarkup(
        ctx,
        buildPartnerModerationKeyboard(pending.submissionId),
        messageRef,
      )
    }
    await ctx.reply('Отклонение отменено. Заявка по-прежнему на проверке.')
    return true
  }

  if (text.length < 3) {
    await ctx.reply('Укажите причину отклонения (минимум 3 символа) или напишите «отмена».')
    return true
  }

  if (text.length > 500) {
    await ctx.reply('Причина слишком длинная (максимум 500 символов). Сократи текст.')
    return true
  }

  const messageRef =
    pending.chatId != null && pending.messageId != null
      ? { chatId: pending.chatId, messageId: pending.messageId }
      : null
  clearPendingRejectReason(adminId)
  let result
  try {
    result = rejectPartnerSubmission(
      pending.submissionId,
      `tg:${adminId}`,
      text,
      `tg-reject:${adminId}:${Date.now()}`,
    )
  } catch (error) {
    console.error('[partner-admin] reject threw', {
      submissionId: pending.submissionId,
      message: error instanceof Error ? error.message : 'unknown_error',
    })
    if (messageRef) {
      await editPartnerReplyMarkup(
        ctx,
        buildPartnerModerationKeyboard(pending.submissionId),
        messageRef,
      )
    }
    await ctx.reply('Не удалось отклонить заявку.')
    return true
  }

  console.info('[partner-admin] reject result', {
    submissionId: pending.submissionId,
    success: Boolean(result?.success),
    status: result?.submission?.status || null,
    rejectionReason: result?.submission?.rejectionReason || null,
  })

  if (!result?.success) {
    const status = String(result?.submission?.status || '').toLowerCase()
    if (messageRef) {
      if (status === 'approved') {
        await markModerationResult(ctx, PARTNER_APPROVED_LABEL, messageRef)
      } else if (status === 'rejected') {
        await markModerationResult(ctx, PARTNER_REJECTED_LABEL, messageRef)
      } else {
        await editPartnerReplyMarkup(
          ctx,
          buildPartnerModerationKeyboard(pending.submissionId),
          messageRef,
        )
      }
    }
    await ctx.reply(result?.message || 'Не удалось отклонить заявку.')
    return true
  }

  await markModerationResult(ctx, PARTNER_REJECTED_LABEL, messageRef)
  try {
    await notifyUserPartnerDecision(result.submission)
  } catch (error) {
    console.error('[partner-admin] reject user notify threw', {
      submissionId: pending.submissionId,
      message: error instanceof Error ? error.message : 'unknown_error',
    })
  }
  await ctx.reply(
    `❌ Заявка <code>${escapeHtml(pending.submissionId)}</code> отклонена.\nПричина: ${escapeHtml(text)}`,
    { parse_mode: 'HTML' },
  )
  return true
}

export { isAdminTelegramUser, getAdminTelegramIds }
