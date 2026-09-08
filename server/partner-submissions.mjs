import {
  findPartnerTask,
  rewardHistoryDescription,
  validatePartnerAccountId,
} from './partners.mjs'
import { withStore, withStoreRead } from './store.mjs'
import {
  assertSafeScreenshot,
  createSubmissionId,
  deleteSubmissionScreenshot,
  resolveSubmissionScreenshotPath,
  saveSubmissionScreenshot,
} from './uploads.mjs'
import { addCoins, hasEvent, TX_TYPE } from './wallet.mjs'

function accountBindKey(partnerId, partnerAccountId) {
  return `${partnerId}:${partnerAccountId}`
}

function requestEventKey(userId, requestId) {
  return `partner:submission:${userId}:${requestId}`
}

function rewardEventId(taskId, telegramUserId) {
  return `task:${taskId}:${telegramUserId}`
}

function publicSubmission(submission, { includeAdmin = false } = {}) {
  const base = {
    submissionId: submission.submissionId,
    telegramUserId: submission.telegramUserId,
    partnerId: submission.partnerId,
    partnerName: submission.partnerName,
    taskId: submission.taskId,
    taskTitle: submission.taskTitle,
    partnerAccountId: submission.partnerAccountId,
    status: submission.status,
    createdAt: submission.createdAt,
    reviewedAt: submission.reviewedAt || null,
    rejectionReason: submission.rejectionReason || null,
    reward: submission.reward,
  }

  if (!includeAdmin) {
    return base
  }

  return {
    ...base,
    reviewedBy: submission.reviewedBy || null,
    screenshotPath: submission.screenshotPath,
    requestId: submission.requestId,
  }
}

function findPendingSubmission(store, userId, partnerId, taskId) {
  return Object.values(store.partnerSubmissions || {}).find(
    (item) =>
      Number(item.telegramUserId) === Number(userId) &&
      item.partnerId === partnerId &&
      item.taskId === taskId &&
      item.status === 'pending',
  )
}

export function createPartnerSubmissionOnStore(store, userId, payload, file) {
  store.partnerSubmissions = store.partnerSubmissions || {}
  store.partnerAccountBinds = store.partnerAccountBinds || {}
  store.events = store.events || {}

  const taskId = String(payload?.taskId || '').trim()
  const requestId = String(payload?.requestId || '').trim()
  const partnerAccountIdRaw = payload?.partnerAccountId

  if (!requestId) {
    return {
      success: false,
      code: 'MISSING_REQUEST_ID',
      message: 'Нужен requestId для этой операции.',
    }
  }

  const found = findPartnerTask(taskId)
  if (!found) {
    return { success: false, message: 'Задание партнёра не найдено.' }
  }

  if (found.partner.hidden) {
    return {
      success: false,
      code: 'PARTNER_UNAVAILABLE',
      message: 'Этот партнёр сейчас недоступен.',
    }
  }

  const accountCheck = validatePartnerAccountId(found.partner, partnerAccountIdRaw)
  if (!accountCheck.ok) {
    return { success: false, message: accountCheck.message }
  }

  const screenshotCheck = assertSafeScreenshot(
    file?.buffer,
    file?.mimetype,
    file?.originalname,
  )
  if (!screenshotCheck.ok) {
    return { success: false, message: screenshotCheck.message }
  }

  const user = store.users[String(userId)]
  if (!user) {
    return { success: false, message: 'Пользователь не найден.' }
  }

  const existingRequest = store.events[requestEventKey(userId, requestId)]
  if (existingRequest?.submissionId && store.partnerSubmissions[existingRequest.submissionId]) {
    const existing = store.partnerSubmissions[existingRequest.submissionId]
    if (
      Number(existing.telegramUserId) === Number(userId) &&
      (existing.status === 'pending' || existing.status === 'approved')
    ) {
      return {
        success: true,
        message:
          existing.status === 'pending' ? 'Заявка уже отправлена.' : 'Задание уже выполнено.',
        submission: publicSubmission(existing),
      }
    }
  }

  if (
    hasEvent(store, rewardEventId(taskId, user.telegramId)) ||
    (user.completedTasks || []).includes(taskId)
  ) {
    return { success: false, message: 'Задание уже выполнено.' }
  }

  if (found.previousTask && !(user.completedTasks || []).includes(found.previousTask.id)) {
    return {
      success: false,
      message: 'Сначала выполни предыдущее задание.',
    }
  }

  if (findPendingSubmission(store, userId, found.partner.id, taskId)) {
    return {
      success: false,
      code: 'PENDING_EXISTS',
      message: 'Заявка уже на проверке. Дождись решения администратора.',
    }
  }

  // One primary screenshot per submission; clean up old rejected files for this task.
  for (const old of Object.values(store.partnerSubmissions)) {
    if (
      Number(old.telegramUserId) === Number(userId) &&
      old.taskId === taskId &&
      old.status === 'rejected' &&
      old.screenshotPath
    ) {
      deleteSubmissionScreenshot(old.screenshotPath)
      old.screenshotPath = null
      old.screenshotDeletedAt = new Date().toISOString()
    }
  }

  const bindKey = accountBindKey(found.partner.id, accountCheck.value)
  const existingBind = store.partnerAccountBinds[bindKey]
  if (existingBind && Number(existingBind.telegramUserId) !== Number(userId)) {
    return {
      success: false,
      code: 'ACCOUNT_TAKEN',
      message: 'Этот ID партнёрского аккаунта уже привязан к другому пользователю.',
    }
  }

  const conflictingPending = Object.values(store.partnerSubmissions).find(
    (item) =>
      item.partnerId === found.partner.id &&
      item.partnerAccountId === accountCheck.value &&
      item.status === 'pending' &&
      Number(item.telegramUserId) !== Number(userId),
  )
  if (conflictingPending) {
    return {
      success: false,
      code: 'ACCOUNT_TAKEN',
      message: 'Этот ID партнёрского аккаунта уже на проверке у другого пользователя.',
    }
  }

  const submissionId = createSubmissionId()
  let savedFile
  try {
    savedFile = saveSubmissionScreenshot(
      submissionId,
      file.buffer,
      screenshotCheck.type.ext,
    )
  } catch {
    return { success: false, message: 'Не удалось сохранить скриншот.' }
  }

  const now = new Date().toISOString()
  const submission = {
    submissionId,
    telegramUserId: Number(userId),
    partnerId: found.partner.id,
    partnerName: found.partner.name,
    taskId,
    taskTitle: found.task.title,
    taskType: found.task.type,
    partnerAccountId: accountCheck.value,
    screenshotPath: savedFile.relativePath,
    screenshotMime: screenshotCheck.type.mime,
    status: 'pending',
    createdAt: now,
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    reward: found.task.reward,
    requestId,
  }

  store.partnerSubmissions[submissionId] = submission
  user.startedPartnerTasks = [...new Set([...(user.startedPartnerTasks || []), taskId])]

  store.events[requestEventKey(userId, requestId)] = {
    eventId: requestEventKey(userId, requestId),
    userId,
    submissionId,
    createdAt: now,
  }

  return {
    success: true,
    message: 'Заявка отправлена на проверку.',
    submission: publicSubmission(submission),
  }
}

export function approvePartnerSubmissionOnStore(store, submissionId, reviewedBy, requestId = '') {
  store.partnerSubmissions = store.partnerSubmissions || {}
  store.partnerAccountBinds = store.partnerAccountBinds || {}
  store.events = store.events || {}

  const submission = store.partnerSubmissions[submissionId]
  if (!submission) {
    return { success: false, message: 'Заявка не найдена.' }
  }

  const approveKey = requestId
    ? `partner:approve:${submissionId}:${requestId}`
    : `partner:approve:${submissionId}`

  if (store.events[approveKey]?.done || submission.status === 'approved') {
    return {
      success: true,
      message: 'Заявка уже подтверждена.',
      submission: publicSubmission(submission, { includeAdmin: true }),
    }
  }

  if (submission.status !== 'pending') {
    return { success: false, message: 'Эту заявку нельзя подтвердить.' }
  }

  const found = findPartnerTask(submission.taskId)
  if (!found) {
    return { success: false, message: 'Задание партнёра не найдено.' }
  }

  const user = store.users[String(submission.telegramUserId)]
  if (!user) {
    return { success: false, message: 'Пользователь не найден.' }
  }

  if (found.previousTask && !(user.completedTasks || []).includes(found.previousTask.id)) {
    return {
      success: false,
      message: 'Предыдущее задание ещё не подтверждено.',
    }
  }

  const bindKey = accountBindKey(submission.partnerId, submission.partnerAccountId)
  const existingBind = store.partnerAccountBinds[bindKey]
  if (
    existingBind &&
    Number(existingBind.telegramUserId) !== Number(submission.telegramUserId)
  ) {
    submission.status = 'rejected'
    submission.reviewedAt = new Date().toISOString()
    submission.reviewedBy = String(reviewedBy || 'admin')
    submission.rejectionReason =
      'Этот ID уже привязан к другому пользователю. Отправь заявку с другим ID.'
    return {
      success: false,
      code: 'ACCOUNT_TAKEN',
      message: 'Этот ID уже привязан к другому пользователю.',
      submission: publicSubmission(submission, { includeAdmin: true }),
    }
  }

  const eventId = rewardEventId(submission.taskId, user.telegramId)
  if (hasEvent(store, eventId) || (user.completedTasks || []).includes(submission.taskId)) {
    submission.status = 'approved'
    submission.reviewedAt = new Date().toISOString()
    submission.reviewedBy = String(reviewedBy || 'admin')
    store.events[approveKey] = {
      eventId: approveKey,
      done: true,
      createdAt: submission.reviewedAt,
    }
    return {
      success: true,
      message: 'Награда уже была начислена ранее.',
      submission: publicSubmission(submission, { includeAdmin: true }),
    }
  }

  const reward = found.task.reward
  const description = rewardHistoryDescription(found.partner, found.task)
  const grant = addCoins(store, user, reward, TX_TYPE.PARTNER_REWARD, eventId, {
    referenceId: submission.submissionId,
    description,
  })

  if (!grant.granted && grant.reason === 'already_granted') {
    submission.status = 'approved'
    submission.reviewedAt = new Date().toISOString()
    submission.reviewedBy = String(reviewedBy || 'admin')
    store.events[approveKey] = {
      eventId: approveKey,
      done: true,
      createdAt: submission.reviewedAt,
    }
    return {
      success: true,
      message: 'Награда уже была начислена ранее.',
      submission: publicSubmission(submission, { includeAdmin: true }),
    }
  }

  if (!grant.granted) {
    return {
      success: false,
      message: 'Не удалось начислить награду. Попробуй ещё раз.',
    }
  }

  user.completedTasks = [...new Set([...(user.completedTasks || []), submission.taskId])]
  submission.status = 'approved'
  submission.reward = reward
  submission.reviewedAt = new Date().toISOString()
  submission.reviewedBy = String(reviewedBy || 'admin')
  submission.rejectionReason = null

  store.partnerAccountBinds[bindKey] = {
    telegramUserId: Number(submission.telegramUserId),
    submissionId: submission.submissionId,
    partnerId: submission.partnerId,
    partnerAccountId: submission.partnerAccountId,
    boundAt: submission.reviewedAt,
  }

  store.events[approveKey] = {
    eventId: approveKey,
    done: true,
    createdAt: submission.reviewedAt,
  }

  return {
    success: true,
    message: `Заявка подтверждена. Начислено ${reward} монет.`,
    submission: publicSubmission(submission, { includeAdmin: true }),
  }
}

export function rejectPartnerSubmissionOnStore(
  store,
  submissionId,
  reviewedBy,
  rejectionReason,
  requestId = '',
) {
  store.partnerSubmissions = store.partnerSubmissions || {}
  store.events = store.events || {}

  const submission = store.partnerSubmissions[submissionId]
  if (!submission) {
    return { success: false, message: 'Заявка не найдена.' }
  }

  const rejectKey = requestId
    ? `partner:reject:${submissionId}:${requestId}`
    : `partner:reject:${submissionId}`

  if (store.events[rejectKey]?.done || submission.status === 'rejected') {
    return {
      success: true,
      message: 'Заявка уже отклонена.',
      submission: publicSubmission(submission, { includeAdmin: true }),
    }
  }

  if (submission.status !== 'pending') {
    return { success: false, message: 'Эту заявку нельзя отклонить.' }
  }

  const reason = String(rejectionReason || '')
    .trim()
    .slice(0, 500)

  submission.status = 'rejected'
  submission.reviewedAt = new Date().toISOString()
  submission.reviewedBy = String(reviewedBy || 'admin')
  submission.rejectionReason = reason || 'Заявка отклонена.'

  store.events[rejectKey] = {
    eventId: rejectKey,
    done: true,
    createdAt: submission.reviewedAt,
  }

  return {
    success: true,
    message: 'Заявка отклонена.',
    submission: publicSubmission(submission, { includeAdmin: true }),
  }
}

export function createPartnerSubmission(userId, payload, file) {
  return withStore((store) => createPartnerSubmissionOnStore(store, userId, payload, file))
}

export function listMyPartnerSubmissions(userId) {
  return withStoreRead((store) => {
    const submissions = Object.values(store.partnerSubmissions || {})
      .filter((item) => Number(item.telegramUserId) === Number(userId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((item) => publicSubmission(item))

    return { success: true, submissions }
  })
}

export function getTaskSubmissionStates(userId) {
  return withStoreRead((store) => {
    const user = store.users[String(userId)]
    if (!user) {
      return { success: false, message: 'Пользователь не найден.', states: {} }
    }

    const latest = {}
    for (const submission of Object.values(store.partnerSubmissions || {}).filter(
      (item) => Number(item.telegramUserId) === Number(userId),
    )) {
      const current = latest[submission.taskId]
      if (
        !current ||
        new Date(submission.createdAt).getTime() > new Date(current.createdAt).getTime()
      ) {
        latest[submission.taskId] = publicSubmission(submission)
      }
    }

    return {
      success: true,
      states: latest,
      completedTaskIds: user.completedTasks || [],
      startedPartnerTasks: user.startedPartnerTasks || [],
    }
  })
}

export function listAdminPartnerSubmissions(statusFilter = '') {
  return withStoreRead((store) => {
    let submissions = Object.values(store.partnerSubmissions || {})
    if (statusFilter && ['pending', 'approved', 'rejected'].includes(statusFilter)) {
      submissions = submissions.filter((item) => item.status === statusFilter)
    }

    submissions = submissions
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((item) => publicSubmission(item, { includeAdmin: true }))

    return { success: true, submissions }
  })
}

export function getAdminSubmission(submissionId) {
  return withStoreRead((store) => {
    const submission = store.partnerSubmissions?.[submissionId]
    if (!submission) {
      return { success: false, message: 'Заявка не найдена.' }
    }

    return {
      success: true,
      submission: publicSubmission(submission, { includeAdmin: true }),
    }
  })
}

export function getSubmissionScreenshot(submissionId, { viewerUserId = null, isAdmin = false } = {}) {
  return withStoreRead((store) => {
    const submission = store.partnerSubmissions?.[submissionId]
    if (!submission) {
      return { success: false, message: 'Заявка не найдена.' }
    }

    if (!isAdmin) {
      if (viewerUserId == null || Number(submission.telegramUserId) !== Number(viewerUserId)) {
        return { success: false, message: 'Нет доступа.' }
      }
    }

    if (!submission.screenshotPath) {
      return { success: false, message: 'Файл не найден.' }
    }

    const absolutePath = resolveSubmissionScreenshotPath(submission.screenshotPath)
    if (!absolutePath) {
      return { success: false, message: 'Файл не найден.' }
    }

    const mime =
      submission.screenshotMime === 'image/jpeg' ||
      submission.screenshotMime === 'image/png' ||
      submission.screenshotMime === 'image/webp'
        ? submission.screenshotMime
        : 'application/octet-stream'

    return {
      success: true,
      absolutePath,
      mime,
      submission: publicSubmission(submission, { includeAdmin: isAdmin }),
    }
  })
}

export function approvePartnerSubmission(submissionId, reviewedBy, requestId = '') {
  return withStore((store) =>
    approvePartnerSubmissionOnStore(store, submissionId, reviewedBy, requestId),
  )
}

export function rejectPartnerSubmission(submissionId, reviewedBy, rejectionReason, requestId = '') {
  return withStore((store) =>
    rejectPartnerSubmissionOnStore(store, submissionId, reviewedBy, rejectionReason, requestId),
  )
}
