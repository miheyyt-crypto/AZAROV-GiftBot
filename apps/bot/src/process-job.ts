import { loadEnv } from "@giftbot/config";
import { inboundEvents } from "@giftbot/db/schema";
import {
  approveWelvuraAccount,
  approveWelvuraDeposit,
  attributeReferral,
  ConflictError,
  countMiniAppOnline,
  createLocalSubmissionFileStorage,
  formatMiniAppOnlineMessage,
  formatWelvuraAdminCaptionAfterReview,
  identifyTelegramUser,
  markBotStarted,
  NotFoundError,
  parseWelvuraAdminCallback,
  rejectWelvuraAccount,
  rejectWelvuraDeposit,
  UserBlockedError,
  userIsAssignedAdmin,
  WelvuraAlreadyModeratedError,
  WELVURA_TELEGRAM_REJECT_REASON,
  readBroadcastJobRef,
  recordBroadcastJobOutcome,
  type GiftbotDb,
  type WelvuraAdminCallback,
} from "@giftbot/domain";
import {
  completeJob,
  enqueueJob,
  JOB_TYPES,
  type ClaimedJob,
} from "@giftbot/jobs";
import { createLogger } from "@giftbot/observability";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import type {
  TelegramInlineButton,
  TelegramInlineKeyboardMarkup,
  TelegramMessageSendOptions,
  TelegramSender,
} from "./sender.js";
import { rethrowClassifiedTelegramError } from "./telegram-errors.js";
import {
  resolveMiniAppUrl,
  resolveStartBannerPath,
  START_WELCOME_CAPTION,
  startWelcomeReplyMarkup,
} from "./start-welcome.js";
import {
  parseAdminCommand,
  parseStartCommand,
  readTelegramUpdate,
} from "./telegram-update.js";

/** @deprecated Use START_WELCOME_CAPTION. Kept so existing imports keep compiling. */
export const START_ACK_TEXT = START_WELCOME_CAPTION;

const logger = createLogger("bot");

function inboundEventIdOf(payload: unknown): string {
  const row =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : undefined;
  const id = row?.inbound_event_id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("inbound_event_id is required");
  }
  return id;
}

function asRecord(payload: unknown): Record<string, unknown> | undefined {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : undefined;
}

function readInlineKeyboard(
  value: unknown,
): TelegramInlineKeyboardMarkup | undefined {
  const markup = asRecord(value);
  if (!markup || !Array.isArray(markup.inline_keyboard)) {
    return undefined;
  }
  const rows: TelegramInlineButton[][] = [];
  for (const row of markup.inline_keyboard) {
    if (!Array.isArray(row)) {
      continue;
    }
    const buttons: TelegramInlineButton[] = [];
    for (const cell of row) {
      const btn = asRecord(cell);
      if (!btn || typeof btn.text !== "string") {
        continue;
      }
      if (typeof btn.callback_data === "string") {
        buttons.push({ text: btn.text, callback_data: btn.callback_data });
        continue;
      }
      if (typeof btn.url === "string") {
        buttons.push({ text: btn.text, url: btn.url });
        continue;
      }
      const webApp = asRecord(btn.web_app);
      if (webApp && typeof webApp.url === "string") {
        buttons.push({ text: btn.text, web_app: { url: webApp.url } });
      }
    }
    if (buttons.length > 0) {
      rows.push(buttons);
    }
  }
  if (rows.length === 0) {
    return undefined;
  }
  return { inline_keyboard: rows };
}

function readSendPayload(payload: unknown): {
  chatId: number | string;
  text: string;
  options?: TelegramMessageSendOptions;
} {
  const row = asRecord(payload);
  const chatId = row?.chat_id;
  const text = row?.text;
  if (
    (typeof chatId !== "number" && typeof chatId !== "string") ||
    typeof text !== "string" ||
    text.length === 0
  ) {
    throw new Error("telegram.send_message payload is invalid");
  }
  const options: TelegramMessageSendOptions = {};
  const parseMode = row?.parse_mode;
  if (
    parseMode === "HTML" ||
    parseMode === "Markdown" ||
    parseMode === "MarkdownV2"
  ) {
    options.parseMode = parseMode;
  }
  if (row?.disable_web_page_preview === true) {
    options.disableWebPagePreview = true;
  }
  const markup = readInlineKeyboard(row?.reply_markup);
  if (markup) {
    options.replyMarkup = markup;
  }
  return {
    chatId,
    text,
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

function readSendPhotoPayload(payload: unknown): {
  chatId: number | string;
  caption?: string;
  parseMode?: TelegramMessageSendOptions["parseMode"];
  miniAppUrl?: string;
  storageKey?: string;
  photoAsset?: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
} {
  const row = asRecord(payload);
  const chatId = row?.chat_id;
  const caption = typeof row?.caption === "string" ? row.caption : undefined;
  const miniAppUrl =
    typeof row?.mini_app_url === "string" ? row.mini_app_url : undefined;
  const storageKey =
    typeof row?.storage_key === "string" ? row.storage_key : undefined;
  const photoAsset =
    typeof row?.photo_asset === "string" ? row.photo_asset : undefined;
  const replyMarkup = readInlineKeyboard(row?.reply_markup);
  const parseMode = row?.parse_mode;
  if (
    (typeof chatId !== "number" && typeof chatId !== "string") ||
    (!storageKey && !photoAsset && !(caption && caption.length > 0))
  ) {
    throw new Error("telegram.send_photo payload is invalid");
  }
  if (!storageKey && (typeof caption !== "string" || caption.length === 0)) {
    throw new Error("telegram.send_photo payload is invalid");
  }
  return {
    chatId,
    ...(caption ? { caption } : {}),
    ...(parseMode === "HTML" || parseMode === "Markdown" || parseMode === "MarkdownV2"
      ? { parseMode }
      : {}),
    ...(miniAppUrl ? { miniAppUrl } : {}),
    ...(storageKey ? { storageKey } : {}),
    ...(photoAsset ? { photoAsset } : {}),
    ...(replyMarkup ? { replyMarkup } : {}),
  };
}

async function markInboundProcessed(
  db: GiftbotDb,
  inboundEventId: string,
): Promise<void> {
  await db
    .update(inboundEvents)
    .set({
      processingStatus: "processed",
      processedAt: new Date(),
      lastError: null,
    })
    .where(eq(inboundEvents.id, inboundEventId));
}

async function processInboundEvent(
  db: GiftbotDb,
  job: ClaimedJob,
): Promise<void> {
  const inboundEventId = inboundEventIdOf(job.payload);
  const rows = await db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.id, inboundEventId))
    .limit(1);
  const inbound = rows[0];
  if (!inbound) {
    throw new Error("inbound event is missing");
  }
  if (inbound.processingStatus === "processed") {
    await completeJob(db, job.id);
    return;
  }

  const update = readTelegramUpdate(inbound.payload);
  const from = update.message?.from ?? update.callback_query?.from;
  if (!from) {
    await markInboundProcessed(db, inbound.id);
    await completeJob(db, job.id);
    return;
  }

  let userId: string;
  try {
    const user = await identifyTelegramUser(db, {
      telegramUserId: BigInt(from.id),
      ...(from.username !== undefined ? { username: from.username } : {}),
      ...(from.first_name !== undefined ? { firstName: from.first_name } : {}),
      ...(from.last_name !== undefined ? { lastName: from.last_name } : {}),
      ...(from.language_code !== undefined
        ? { languageCode: from.language_code }
        : {}),
      ...(from.is_premium !== undefined ? { isPremium: from.is_premium } : {}),
    });
    userId = user.userId;
  } catch (error) {
    if (error instanceof UserBlockedError) {
      await markInboundProcessed(db, inbound.id);
      await completeJob(db, job.id);
      return;
    }
    throw error;
  }

  const welvuraCallback = parseWelvuraAdminCallback(update.callback_query?.data);
  if (update.callback_query && welvuraCallback) {
    await handleWelvuraAdminCallback(db, {
      inboundEventId: inbound.id,
      externalEventId: inbound.externalEventId,
      userId,
      callback: welvuraCallback,
      queryId: update.callback_query.id,
      ...(update.callback_query.message
        ? {
            chatId: update.callback_query.message.chat.id,
            messageId: update.callback_query.message.message_id,
            ...(update.callback_query.message.caption
              ? { caption: update.callback_query.message.caption }
              : {}),
          }
        : {}),
    });
    await markInboundProcessed(db, inbound.id);
    await completeJob(db, job.id);
    return;
  }

  const start = parseStartCommand(update.message?.text);
  if (start.isStart) {
    await markBotStarted(db, userId);
  }
  if (start.payload) {
    await attributeReferralSafe(db, userId, start.payload);
  }

  if (start.isStart && update.message) {
    const miniAppUrl = resolveMiniAppUrl(loadEnv().PUBLIC_BASE_URL);
    await enqueueJob(db, {
      type: JOB_TYPES.telegramSendPhoto,
      idempotencyKey: `telegram:${inbound.externalEventId}:start_ack`,
      payload: {
        chat_id: update.message.chat.id,
        caption: START_WELCOME_CAPTION,
        photo_asset: "start-banner",
        ...(miniAppUrl ? { mini_app_url: miniAppUrl } : {}),
      },
      inboundEventId: inbound.id,
    });
  }

  if (parseAdminCommand(update.message?.text) && update.message) {
    if (await userIsAssignedAdmin(db, userId)) {
      const online = await countMiniAppOnline(db);
      await enqueueJob(db, {
        type: JOB_TYPES.telegramSendMessage,
        idempotencyKey: `telegram:${inbound.externalEventId}:admin_online`,
        payload: {
          chat_id: update.message.chat.id,
          text: formatMiniAppOnlineMessage(online),
        },
        inboundEventId: inbound.id,
      });
    }
  }

  await markInboundProcessed(db, inbound.id);
  await completeJob(db, job.id);
}

async function handleWelvuraAdminCallback(
  db: GiftbotDb,
  input: {
    inboundEventId: string;
    externalEventId: string;
    userId: string;
    callback: WelvuraAdminCallback;
    queryId: string;
    chatId?: number;
    messageId?: number;
    caption?: string;
  },
): Promise<void> {
  let toast = "Готово";
  let reviewed: "approve" | "reject" | undefined;
  const isAdmin = await userIsAssignedAdmin(db, input.userId);
  if (!isAdmin) {
    toast = "Недостаточно прав";
  } else {
    try {
      if (input.callback.action === "approve") {
        if (input.callback.kind === "account") {
          await approveWelvuraAccount(db, {
            submissionId: input.callback.submissionId,
            adminUserId: input.userId,
          });
        } else {
          await approveWelvuraDeposit(db, {
            submissionId: input.callback.submissionId,
            adminUserId: input.userId,
          });
        }
        toast = "Заявка подтверждена";
        reviewed = "approve";
      } else if (input.callback.kind === "account") {
        await rejectWelvuraAccount(db, {
          submissionId: input.callback.submissionId,
          adminUserId: input.userId,
          reason: WELVURA_TELEGRAM_REJECT_REASON,
        });
        toast = "Заявка отклонена";
        reviewed = "reject";
      } else {
        await rejectWelvuraDeposit(db, {
          submissionId: input.callback.submissionId,
          adminUserId: input.userId,
          reason: WELVURA_TELEGRAM_REJECT_REASON,
        });
        toast = "Заявка отклонена";
        reviewed = "reject";
      }
    } catch (error) {
      if (error instanceof WelvuraAlreadyModeratedError) {
        toast = "Заявка уже обработана";
        reviewed = input.callback.action;
      } else if (error instanceof NotFoundError) {
        toast = "Заявка не найдена";
      } else {
        throw error;
      }
    }
  }

  await enqueueJob(db, {
    type: JOB_TYPES.telegramAnswerCallback,
    idempotencyKey: `telegram:${input.externalEventId}:cb_ack`,
    payload: {
      callback_query_id: input.queryId,
      text: toast,
    },
    inboundEventId: input.inboundEventId,
  });

  if (
    isAdmin &&
    reviewed &&
    input.chatId !== undefined &&
    input.messageId !== undefined &&
    input.caption
  ) {
    await enqueueJob(db, {
      type: JOB_TYPES.telegramEditMessage,
      idempotencyKey: `telegram:${input.externalEventId}:cb_edit`,
      payload: {
        chat_id: input.chatId,
        message_id: input.messageId,
        caption: formatWelvuraAdminCaptionAfterReview(input.caption, reviewed),
        reply_markup: { inline_keyboard: [] },
      },
      inboundEventId: input.inboundEventId,
    });
  }
}

async function processAnswerCallback(
  db: GiftbotDb,
  job: ClaimedJob,
  sender: TelegramSender,
): Promise<void> {
  const row = asRecord(job.payload);
  const callbackQueryId = row?.callback_query_id;
  if (typeof callbackQueryId !== "string" || callbackQueryId.length === 0) {
    throw new Error("telegram.answer_callback payload is invalid");
  }
  const text = typeof row?.text === "string" ? row.text : undefined;
  if (text) {
    await sender.answerCallbackQuery(callbackQueryId, text);
  } else {
    await sender.answerCallbackQuery(callbackQueryId);
  }
  await completeJob(db, job.id);
}

async function processEditMessage(
  db: GiftbotDb,
  job: ClaimedJob,
  sender: TelegramSender,
): Promise<void> {
  const row = asRecord(job.payload);
  const chatId = row?.chat_id;
  const messageId = row?.message_id;
  const caption = row?.caption;
  if (
    (typeof chatId !== "number" && typeof chatId !== "string") ||
    typeof messageId !== "number" ||
    typeof caption !== "string" ||
    caption.length === 0
  ) {
    throw new Error("telegram.edit_message payload is invalid");
  }
  const replyMarkup = readInlineKeyboard(row?.reply_markup) ?? {
    inline_keyboard: [],
  };
  await sender.editMessageCaption(chatId, messageId, caption, replyMarkup);
  await completeJob(db, job.id);
}

async function attributeReferralSafe(
  db: GiftbotDb,
  refereeUserId: string,
  code: string,
): Promise<void> {
  try {
    await attributeReferral(db, { refereeUserId, code });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ConflictError) {
      return;
    }
    throw error;
  }
}

async function recordBroadcastIfPresent(
  db: GiftbotDb,
  payload: unknown,
  failed: boolean,
  error?: string,
): Promise<void> {
  const ref = readBroadcastJobRef(payload);
  if (!ref) {
    return;
  }
  await recordBroadcastJobOutcome(db, {
    broadcastId: ref.broadcastId,
    telegramUserId: ref.telegramUserId,
    failed,
    ...(error ? { error } : {}),
  });
}

async function sendTelegram(
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    rethrowClassifiedTelegramError(error);
  }
}

async function processSendMessage(
  db: GiftbotDb,
  job: ClaimedJob,
  sender: TelegramSender,
): Promise<void> {
  const payload = readSendPayload(job.payload);
  await sendTelegram(() =>
    sender.sendMessage(payload.chatId, payload.text, payload.options),
  );
  await completeJob(db, job.id);
  await recordBroadcastIfPresent(db, job.payload, false);
}

async function processSendPhoto(
  db: GiftbotDb,
  job: ClaimedJob,
  sender: TelegramSender,
): Promise<void> {
  const payload = readSendPhotoPayload(job.payload);
  if (payload.storageKey) {
    const uploadDir = loadEnv().UPLOAD_DIR;
    if (!uploadDir) {
      throw new Error("UPLOAD_DIR is required to send submission photos");
    }
    const storage = payload.storageKey.startsWith("broadcasts/")
      ? {
          resolvePath: (key: string) =>
            createLocalSubmissionFileStorage(uploadDir).resolvePath(key),
        }
      : createLocalSubmissionFileStorage(uploadDir);
    const photoPath = storage.resolvePath(payload.storageKey);
    if (!existsSync(photoPath)) {
      throw new Error("submission photo is missing");
    }
    await sendTelegram(() =>
      sender.sendPhoto(payload.chatId, {
        photoPath,
        ...(payload.caption ? { caption: payload.caption } : {}),
        ...(payload.parseMode ? { parseMode: payload.parseMode } : {}),
        ...(payload.replyMarkup ? { replyMarkup: payload.replyMarkup } : {}),
      }),
    );
    await completeJob(db, job.id);
    await recordBroadcastIfPresent(db, job.payload, false);
    return;
  }

  const photoPath = resolveStartBannerPath();
  if (!photoPath) {
    logger.error("start banner file is missing", {
      asset: "apps/bot/assets/start-banner.jpg",
    });
    await completeJob(db, job.id);
    return;
  }
  await sender.sendPhoto(payload.chatId, {
    photoPath,
    ...(payload.caption ? { caption: payload.caption } : {}),
    ...(payload.miniAppUrl
      ? {
          replyMarkup: startWelcomeReplyMarkup(
            payload.miniAppUrl,
          ) as unknown as TelegramInlineKeyboardMarkup,
        }
      : {}),
  });
  await completeJob(db, job.id);
}

export async function processBotJob(
  db: GiftbotDb,
  job: ClaimedJob,
  sender: TelegramSender,
): Promise<void> {
  if (job.owner !== "bot" || !job.type.startsWith("telegram.")) {
    throw new Error("bot refuses non-telegram jobs");
  }

  if (job.type === JOB_TYPES.telegramProcessInbound) {
    await processInboundEvent(db, job);
    return;
  }
  if (job.type === JOB_TYPES.telegramSendMessage) {
    await processSendMessage(db, job, sender);
    return;
  }
  if (job.type === JOB_TYPES.telegramSendPhoto) {
    await processSendPhoto(db, job, sender);
    return;
  }
  if (job.type === JOB_TYPES.telegramAnswerCallback) {
    await processAnswerCallback(db, job, sender);
    return;
  }
  if (job.type === JOB_TYPES.telegramEditMessage) {
    await processEditMessage(db, job, sender);
    return;
  }

  throw new Error(`unsupported bot job type: ${job.type}`);
}
