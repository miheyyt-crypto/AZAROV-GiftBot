import { Markup } from 'telegraf'

import {
  createPromoCode,
  deactivatePromoCode,
  isValidPromoCodeFormat,
  listPromoCodes,
  normalizePromoCode,
  PROMO_MAX_USES_MAX,
  PROMO_REWARD_MAX,
} from './promo.mjs'
import { answerTelegramCallback, isAdminTelegramUser } from './telegram-notify.mjs'

/** Per-admin create wizard. Keys are string telegram user ids. */
const pendingPromoByAdmin = new Map()
const WIZARD_TTL_MS = 30 * 60 * 1000

export function clearPendingPromoWizards() {
  pendingPromoByAdmin.clear()
}

export function getPendingPromoWizard(adminId) {
  const key = String(adminId ?? '').trim()
  const entry = pendingPromoByAdmin.get(key)
  if (!entry) {
    return null
  }
  if (entry.expiresAt < Date.now()) {
    pendingPromoByAdmin.delete(key)
    return null
  }
  return entry
}

function setPendingPromoWizard(adminId, patch) {
  const key = String(adminId)
  const prev = getPendingPromoWizard(adminId) || {
    step: 'idle',
    code: null,
    reward: null,
    maxUses: null,
  }
  pendingPromoByAdmin.set(key, {
    ...prev,
    ...patch,
    expiresAt: Date.now() + WIZARD_TTL_MS,
  })
}

function clearPendingPromoWizard(adminId) {
  pendingPromoByAdmin.delete(String(adminId))
}

export function answerPromoCallback(ctx, text = undefined, showAlert = false) {
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

function usesLabel(count) {
  const n = Math.floor(Number(count) || 0)
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) {
    return `${n} использование`
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${n} использования`
  }
  return `${n} использований`
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Создать', 'promo:confirm'),
      Markup.button.callback('❌ Отмена', 'promo:cancel'),
    ],
  ])
}

function formatConfirmText(draft) {
  return [
    'Проверьте данные:',
    '',
    `🎁 Промокод: <b>${escapeHtml(draft.code)}</b>`,
    `🪙 Награда: <b>${draft.reward}</b> монет`,
    `👥 Использований: <b>${draft.maxUses}</b>`,
    '',
    'Создать?',
  ].join('\n')
}

function formatCreatedText(promo) {
  return [
    '✅ Промокод успешно создан!',
    '',
    `🎁 <b>${escapeHtml(promo.code)}</b>`,
    `🪙 ${promo.reward} монет`,
    `👥 ${usesLabel(promo.maxUses)}`,
  ].join('\n')
}

function formatListLine(promo) {
  const exhausted = promo.remainingUses <= 0
  const status = !promo.active ? '🔴 Отключён' : exhausted ? '🔴 Использован' : '🟢 Активен'
  return [
    `🎁 <b>${escapeHtml(promo.code)}</b>`,
    `🪙 ${promo.reward}`,
    `👥 ${promo.usedCount}/${promo.maxUses}`,
    status,
  ].join('\n')
}

export async function startPromoCreateWizard(ctx) {
  const adminId = ctx.from?.id
  if (!isAdminTelegramUser(adminId)) {
    await ctx.reply('❌ У вас нет доступа к этой команде.')
    return true
  }

  setPendingPromoWizard(adminId, {
    step: 'await_code',
    code: null,
    reward: null,
    maxUses: null,
  })

  await ctx.reply(['🎁 Создание промокода', '', 'Введите промокод:'].join('\n'))
  return true
}

export async function handlePromoListCommand(ctx) {
  const adminId = ctx.from?.id
  if (!isAdminTelegramUser(adminId)) {
    await ctx.reply('❌ У вас нет доступа к этой команде.')
    return true
  }

  const list = listPromoCodes()
  if (!list.length) {
    await ctx.reply('Промокодов пока нет.\nСоздайте через /промокод')
    return true
  }

  const chunks = []
  let buffer = '📋 Промокоды:\n'
  for (const promo of list) {
    const block = `\n${formatListLine(promo)}\n`
    if (`${buffer}${block}`.length > 3500) {
      chunks.push(buffer)
      buffer = block
    } else {
      buffer += block
    }
  }
  chunks.push(buffer)

  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: 'HTML' })
  }
  return true
}

export async function handlePromoDeactivateCommand(ctx, rawArg = '') {
  const adminId = ctx.from?.id
  if (!isAdminTelegramUser(adminId)) {
    await ctx.reply('❌ У вас нет доступа к этой команде.')
    return true
  }

  const code = normalizePromoCode(rawArg)
  if (!code) {
    await ctx.reply('Использование:\n/deactivate_promo CODE')
    return true
  }

  const result = deactivatePromoCode(code)
  if (!result.success) {
    await ctx.reply(`❌ ${result.message}`)
    return true
  }

  if (result.alreadyInactive) {
    await ctx.reply(`Промокод ${result.promo.code} уже отключён.`)
    return true
  }

  await ctx.reply(`🔴 Промокод ${result.promo.code} отключён.`)
  return true
}

export async function handlePromoCancelCommand(ctx) {
  const adminId = ctx.from?.id
  if (!adminId || !getPendingPromoWizard(adminId)) {
    return false
  }
  clearPendingPromoWizard(adminId)
  if (isAdminTelegramUser(adminId)) {
    await ctx.reply('Создание промокода отменено.')
  }
  return true
}

export async function handlePromoWizardMessage(ctx) {
  const adminId = ctx.from?.id
  if (!adminId || !isAdminTelegramUser(adminId)) {
    return false
  }

  const pending = getPendingPromoWizard(adminId)
  if (!pending || pending.step === 'idle' || pending.step === 'await_confirm') {
    return false
  }

  const text = String(ctx.message?.text || '').trim()
  if (!text) {
    return true
  }

  if (pending.step === 'await_code') {
    const code = normalizePromoCode(text)
    if (!isValidPromoCodeFormat(code)) {
      await ctx.reply(
        '❌ Некорректный код.\nИспользуйте 3–32 символа: A-Z, 0-9, _ или -.\nВведите промокод ещё раз:',
      )
      return true
    }

    setPendingPromoWizard(adminId, { step: 'await_reward', code })
    await ctx.reply('🪙 Сколько монет будет давать промокод?')
    return true
  }

  if (pending.step === 'await_reward') {
    const reward = Math.floor(Number(String(text).replace(/\s+/g, '')))
    if (!Number.isInteger(reward) || reward < 1 || reward > PROMO_REWARD_MAX) {
      await ctx.reply(
        `❌ Введите целое число от 1 до ${PROMO_REWARD_MAX}.\nСколько монет будет давать промокод?`,
      )
      return true
    }

    setPendingPromoWizard(adminId, { step: 'await_max_uses', reward })
    await ctx.reply('👥 Сколько раз можно использовать этот промокод?')
    return true
  }

  if (pending.step === 'await_max_uses') {
    const maxUses = Math.floor(Number(String(text).replace(/\s+/g, '')))
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > PROMO_MAX_USES_MAX) {
      await ctx.reply(
        `❌ Введите целое число от 1 до ${PROMO_MAX_USES_MAX}.\nСколько раз можно использовать этот промокод?`,
      )
      return true
    }

    setPendingPromoWizard(adminId, { step: 'await_confirm', maxUses })
    const draft = getPendingPromoWizard(adminId)
    await ctx.reply(formatConfirmText(draft), {
      parse_mode: 'HTML',
      ...confirmKeyboard(),
    })
    return true
  }

  return false
}

export async function handlePromoAdminCallback(ctx) {
  const data = String(ctx.callbackQuery?.data || '')
  if (!data.startsWith('promo:')) {
    return false
  }

  const adminId = ctx.from?.id
  if (!isAdminTelegramUser(adminId)) {
    await answerPromoCallback(ctx, 'Нет доступа', true)
    return true
  }

  if (data === 'promo:cancel') {
    clearPendingPromoWizard(adminId)
    await answerPromoCallback(ctx)
    await ctx.reply('Создание промокода отменено.')
    return true
  }

  if (data === 'promo:confirm') {
    const pending = getPendingPromoWizard(adminId)
    if (!pending || pending.step !== 'await_confirm') {
      await answerPromoCallback(ctx, 'Сессия истекла', true)
      return true
    }

    const result = createPromoCode({
      code: pending.code,
      reward: pending.reward,
      maxUses: pending.maxUses,
      createdBy: adminId,
    })

    clearPendingPromoWizard(adminId)
    await answerPromoCallback(ctx)

    if (!result.success) {
      await ctx.reply(`❌ ${result.message}`)
      return true
    }

    await ctx.reply(formatCreatedText(result.promo), { parse_mode: 'HTML' })
    return true
  }

  await answerPromoCallback(ctx)
  return true
}
