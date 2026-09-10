import {
  BROADCAST_STATUS,
  cancelBroadcastDraft,
  countBroadcastRecipients,
  createBroadcastDraft,
  getBroadcast,
  queueBroadcast,
  requestStopBroadcast,
} from './broadcasts.mjs'
import { sendAdminRootMenu } from './community-admin.mjs'
import {
  answerTelegramCallback,
  copyTelegramMessage,
  isAdminTelegramUser,
} from './telegram-notify.mjs'

/** Per-admin broadcast creation wizard. */
const pendingBroadcastByAdmin = new Map()
const WIZARD_TTL_MS = 30 * 60 * 1000
const TEXT_MAX = 4096
const CAPTION_MAX = 1024

export function clearPendingBroadcastWizards() {
  pendingBroadcastByAdmin.clear()
}

export function getPendingBroadcastWizard(adminId) {
  const key = String(adminId ?? '').trim()
  const entry = pendingBroadcastByAdmin.get(key)
  if (!entry) {
    return null
  }
  if (entry.expiresAt < Date.now()) {
    pendingBroadcastByAdmin.delete(key)
    return null
  }
  return entry
}

function setPendingBroadcastWizard(adminId, patch) {
  const key = String(adminId)
  const prev = getPendingBroadcastWizard(adminId) || {
    step: 'idle',
    broadcastId: null,
  }
  pendingBroadcastByAdmin.set(key, {
    ...prev,
    ...patch,
    expiresAt: Date.now() + WIZARD_TTL_MS,
  })
}

function clearPendingBroadcastWizard(adminId) {
  pendingBroadcastByAdmin.delete(String(adminId))
}

export function answerBroadcastCallback(ctx, text = undefined, showAlert = false) {
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
        await answerTelegramCallback(id, text || '', { showAlert })
      }
    })
}

function cancelKeyboard() {
  return {
    inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'bc:cancel' }]],
  }
}

function confirmKeyboard(broadcastId) {
  return {
    inline_keyboard: [
      [{ text: '✅ Отправить', callback_data: `bc:send:${broadcastId}` }],
      [{ text: '❌ Отмена', callback_data: 'bc:cancel' }],
    ],
  }
}

function formatRecipientCount(count) {
  return Number(count || 0).toLocaleString('ru-RU')
}

export async function startBroadcastCreateWizard(ctx) {
  const adminId = ctx.from?.id
  if (!isAdminTelegramUser(adminId)) {
    await ctx.reply('⛔ Недостаточно прав.')
    return true
  }

  setPendingBroadcastWizard(adminId, {
    step: 'await_content',
    broadcastId: null,
  })

  await ctx.reply(
    [
      '📢 <b>Создание рассылки</b>',
      '',
      'Отправьте сообщение, которое хотите отправить пользователям.',
      '',
      'Можно отправить:',
      '• только текст',
      '• фото + текст',
      '',
      'Для отмены нажмите «Отмена».',
    ].join('\n'),
    { parse_mode: 'HTML', reply_markup: cancelKeyboard() },
  )
  return true
}

export async function handleBroadcastCancelCommand(ctx) {
  const adminId = ctx.from?.id
  if (!adminId || !getPendingBroadcastWizard(adminId)) {
    return false
  }
  const pending = getPendingBroadcastWizard(adminId)
  clearPendingBroadcastWizard(adminId)
  if (pending?.broadcastId) {
    cancelBroadcastDraft(pending.broadcastId, adminId)
  }
  if (isAdminTelegramUser(adminId)) {
    await ctx.reply('Создание рассылки отменено.')
  }
  return true
}

async function showPreview(ctx, broadcast) {
  const total = broadcast.total || 0
  await ctx.reply(
    [
      '📢 <b>ПРЕДПРОСМОТР</b>',
      '',
      'Сообщение выше — то, что получат пользователи.',
      '',
      `👥 Получателей: <b>${formatRecipientCount(total)}</b>`,
      '',
      'Запустить рассылку?',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: confirmKeyboard(broadcast.id),
    },
  )
}

function extractContentFromMessage(message) {
  if (!message) {
    return null
  }

  const chatId = message.chat?.id
  const messageId = message.message_id
  if (chatId == null || messageId == null) {
    return null
  }

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const caption = String(message.caption || '')
    if (caption.length > CAPTION_MAX) {
      return { error: `Подпись слишком длинная (макс. ${CAPTION_MAX} символов).` }
    }
    return {
      contentType: 'photo',
      sourceChatId: chatId,
      sourceMessageId: messageId,
      textPreview: caption || '[фото]',
    }
  }

  if (typeof message.text === 'string' && message.text.trim()) {
    const text = message.text
    if (text.length > TEXT_MAX) {
      return { error: `Текст слишком длинный (макс. ${TEXT_MAX} символов).` }
    }
    return {
      contentType: 'text',
      sourceChatId: chatId,
      sourceMessageId: messageId,
      textPreview: text.slice(0, 200),
    }
  }

  return { error: 'Отправьте текст или одно фото с подписью.' }
}

export async function handleBroadcastWizardMessage(ctx) {
  const adminId = ctx.from?.id
  if (!adminId || !isAdminTelegramUser(adminId)) {
    return false
  }

  const pending = getPendingBroadcastWizard(adminId)
  if (!pending || pending.step !== 'await_content') {
    return false
  }

  const extracted = extractContentFromMessage(ctx.message)
  if (!extracted || extracted.error) {
    await ctx.reply(extracted?.error || 'Отправьте текст или фото с подписью.', {
      reply_markup: cancelKeyboard(),
    })
    return true
  }

  const created = createBroadcastDraft({
    adminId,
    contentType: extracted.contentType,
    sourceChatId: extracted.sourceChatId,
    sourceMessageId: extracted.sourceMessageId,
    textPreview: extracted.textPreview,
  })

  if (!created.success || !created.broadcast) {
    await ctx.reply(created.message || 'Не удалось создать черновик рассылки.')
    return true
  }

  // True preview: copy the source message back to admin (same chat), preserving media/entities.
  await copyTelegramMessage(adminId, extracted.sourceChatId, extracted.sourceMessageId)

  setPendingBroadcastWizard(adminId, {
    step: 'await_confirm',
    broadcastId: created.broadcast.id,
  })

  await showPreview(ctx, created.broadcast)
  return true
}

export async function handleBroadcastWizardPhoto(ctx) {
  return handleBroadcastWizardMessage(ctx)
}

export async function handleBroadcastAdminCallback(ctx) {
  const data = String(ctx.callbackQuery?.data || '').trim()
  if (!data.startsWith('bc:')) {
    return false
  }

  const adminId = ctx.from?.id
  if (!isAdminTelegramUser(adminId)) {
    await answerBroadcastCallback(ctx, 'Нет доступа', true)
    return true
  }

  if (data === 'bc:menu') {
    await answerBroadcastCallback(ctx)
    await startBroadcastCreateWizard(ctx)
    return true
  }

  if (data === 'bc:cancel') {
    await answerBroadcastCallback(ctx)
    const pending = getPendingBroadcastWizard(adminId)
    clearPendingBroadcastWizard(adminId)
    if (pending?.broadcastId) {
      cancelBroadcastDraft(pending.broadcastId, adminId)
    }
    await ctx.reply('Создание рассылки отменено.')
    await sendAdminRootMenu(ctx)
    return true
  }

  const stopMatch = /^bc:stop:(BC-[A-Z0-9]+)$/i.exec(data)
  if (stopMatch) {
    await answerBroadcastCallback(ctx, 'Останавливаем…')
    const result = requestStopBroadcast(stopMatch[1], adminId)
    if (!result.success) {
      await ctx.reply(result.message || 'Не удалось остановить рассылку.')
      return true
    }
    await ctx.reply('⏹ Остановка рассылки запрошена. Уже отправленные сообщения останутся.')
    return true
  }

  const sendMatch = /^bc:send:(BC-[A-Z0-9]+)$/i.exec(data)
  if (sendMatch) {
    const broadcastId = sendMatch[1].toUpperCase()
    const pending = getPendingBroadcastWizard(adminId)
    if (!pending || pending.broadcastId !== broadcastId || pending.step !== 'await_confirm') {
      await answerBroadcastCallback(ctx, 'Сессия истекла', true)
      return true
    }

    const existing = getBroadcast(broadcastId)
    if (!existing) {
      await answerBroadcastCallback(ctx, 'Не найдено', true)
      clearPendingBroadcastWizard(adminId)
      return true
    }

    // Progress message first, then queue (atomic).
    const progress = await ctx.reply(
      [
        '🚀 <b>Рассылка запускается…</b>',
        '',
        `Отправлено: <b>0</b> / <b>${formatRecipientCount(existing.total)}</b>`,
        '✅ Успешно: <b>0</b>',
        '❌ Ошибки: <b>0</b>',
      ].join('\n'),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '⏹ Остановить', callback_data: `bc:stop:${broadcastId}` }]],
        },
      },
    )

    const queued = queueBroadcast(broadcastId, adminId, {
      chatId: progress.chat.id,
      messageId: progress.message_id,
    })

    clearPendingBroadcastWizard(adminId)
    await answerBroadcastCallback(ctx)

    if (!queued.success) {
      await ctx.reply(queued.message || 'Не удалось запустить рассылку.')
      return true
    }

    await ctx.reply('📢 Рассылка запущена. Бот продолжит работать в фоне.')
    return true
  }

  await answerBroadcastCallback(ctx)
  return true
}

export { countBroadcastRecipients, BROADCAST_STATUS }
