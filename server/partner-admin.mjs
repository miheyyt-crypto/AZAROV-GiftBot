import {
  answerTelegramCallback,
  editTelegramReplyMarkup,
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

/** Admin awaiting rejection reason text. */
const pendingRejectByAdmin = new Map()

const REJECT_REASON_TTL_MS = 15 * 60 * 1000

export function clearPendingRejectReasons() {
  pendingRejectByAdmin.clear()
}

export function getPendingRejectReason(adminId) {
  const entry = pendingRejectByAdmin.get(Number(adminId))
  if (!entry) {
    return null
  }
  if (entry.expiresAt < Date.now()) {
    pendingRejectByAdmin.delete(Number(adminId))
    return null
  }
  return entry
}

function setPendingRejectReason(adminId, submissionId) {
  pendingRejectByAdmin.set(Number(adminId), {
    submissionId: String(submissionId),
    expiresAt: Date.now() + REJECT_REASON_TTL_MS,
  })
}

function clearPendingRejectReason(adminId) {
  pendingRejectByAdmin.delete(Number(adminId))
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

export function parsePartnerModerationCallback(data) {
  const raw = String(data || '').trim()
  const match = /^(vellur|welvura|partner):(approve|reject):([0-9a-fA-F-]{8,64})$/.exec(raw)
  if (!match) {
    return null
  }
  return {
    action: match[2],
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
  const chatId = Number(submission.telegramUserId)
  if (!Number.isFinite(chatId)) {
    return { ok: false, reason: 'missing_user' }
  }

  const partnerName = submission.partnerName || 'Partner'
  let text
  if (submission.status === 'approved') {
    const reward = Number(submission.reward) || 0
    text = [
      `✅ <b>${escapeHtml(partnerName)} подтверждён!</b>`,
      '',
      'Ваша заявка успешно проверена.',
      `🎁 Вам начислено <b>${reward}</b> монет.`,
    ].join('\n')
  } else if (submission.status === 'rejected') {
    text = [
      `❌ <b>${escapeHtml(partnerName)} не подтверждён</b>`,
      '',
      `Причина: ${escapeHtml(submission.rejectionReason || 'Заявка отклонена.')}`,
      '',
      'Вы можете отправить новую заявку после исправления.',
    ].join('\n')
  } else {
    return { ok: false, reason: 'not_final' }
  }

  return sendTelegramMessage(chatId, text, {}, options)
}

async function stripModerationKeyboard(ctx) {
  try {
    const chatId = ctx.callbackQuery?.message?.chat?.id
    const messageId = ctx.callbackQuery?.message?.message_id
    if (chatId != null && messageId != null) {
      await editTelegramReplyMarkup(chatId, messageId, { inline_keyboard: [] })
    }
  } catch {
    // Best-effort — message may be too old or already edited.
  }
}

/**
 * Handle inline approve/reject callbacks from Telegram admins.
 */
export async function handlePartnerModerationCallback(ctx) {
  const data = String(ctx.callbackQuery?.data || '')
  const parsed = parsePartnerModerationCallback(data)
  if (!parsed) {
    return false
  }

  const adminId = ctx.from?.id
  const callbackId = ctx.callbackQuery?.id

  if (!isAdminTelegramUser(adminId)) {
    await answerTelegramCallback(callbackId, 'Нет доступа.', { showAlert: true })
    return true
  }

  if (parsed.action === 'approve') {
    const result = approvePartnerSubmission(
      parsed.submissionId,
      `tg:${adminId}`,
      `tg-approve:${ctx.callbackQuery?.id || Date.now()}`,
    )

    if (!result.success) {
      await answerTelegramCallback(callbackId, result.message || 'Ошибка', { showAlert: true })
      return true
    }

    await answerTelegramCallback(callbackId, 'Подтверждено')
    await stripModerationKeyboard(ctx)
    void notifyUserPartnerDecision(result.submission)
    try {
      await ctx.reply(
        `✅ Заявка <code>${parsed.submissionId}</code> подтверждена.\n${escapeHtml(result.message)}`,
        { parse_mode: 'HTML' },
      )
    } catch {
      // ignore
    }
    return true
  }

  // reject → ask for reason
  setPendingRejectReason(adminId, parsed.submissionId)
  await answerTelegramCallback(callbackId, 'Введите причину отклонения')
  try {
    await ctx.reply(
      [
        `❌ Отклонение заявки <code>${parsed.submissionId}</code>.`,
        '',
        'Введите причину отклонения одним сообщением.',
        'Или напишите «отмена».',
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
    clearPendingRejectReason(adminId)
    await ctx.reply('Отклонение отменено.')
    return true
  }

  clearPendingRejectReason(adminId)
  const result = rejectPartnerSubmission(
    pending.submissionId,
    `tg:${adminId}`,
    text,
    `tg-reject:${adminId}:${Date.now()}`,
  )

  if (!result.success) {
    await ctx.reply(result.message || 'Не удалось отклонить заявку.')
    return true
  }

  void notifyUserPartnerDecision(result.submission)
  await ctx.reply(
    `❌ Заявка <code>${pending.submissionId}</code> отклонена.\nПричина: ${escapeHtml(text)}`,
    { parse_mode: 'HTML' },
  )
  return true
}

export { isAdminTelegramUser, getAdminTelegramIds }
