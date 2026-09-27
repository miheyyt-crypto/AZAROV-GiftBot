import { jobs, telegramAccounts, users } from "@giftbot/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { GiftbotTx } from "./db.js";

export const KICK_STREAM_WATCH_URL = "https://kick.com/azarov7777";
export const STREAM_START_NOTICE_TITLE = "Стрим начался!";

export const STREAM_START_NOTICE_TEXT = [
  `🔴 ${STREAM_START_NOTICE_TITLE}`,
  "",
  "Самое время заглянуть и выполнить ежедневные задания",
  "🔥 Заходи на стрим и начни свой стрик!",
  "",
  "👉 Смотреть на Kick",
  "",
  KICK_STREAM_WATCH_URL,
].join("\n");

export const STREAM_START_NOTICE_HTML = [
  `🔴 <b>${STREAM_START_NOTICE_TITLE}</b>`,
  "",
  "Самое время заглянуть и выполнить ежедневные задания",
  "🔥 Заходи на стрим и начни свой стрик!",
  "",
  "👉 Смотреть на Kick",
  "",
  KICK_STREAM_WATCH_URL,
].join("\n");

export const STREAM_START_WATCH_BUTTON_TEXT = "Зайти на стрим ↗";
export const STREAM_START_TASKS_BUTTON_TEXT = "Выполнять задания ▣";

export type StreamStartInlineButton =
  | { text: string; url: string }
  | { text: string; web_app: { url: string } };

export type StreamStartInlineKeyboard = {
  inline_keyboard: StreamStartInlineButton[][];
};

export function resolveTasksWebAppUrl(
  publicBaseUrl = process.env.PUBLIC_BASE_URL,
): string | undefined {
  const raw = publicBaseUrl?.trim();
  if (!raw) {
    return undefined;
  }
  return `${raw.replace(/\/+$/, "")}/tasks`;
}

export function streamStartReplyMarkup(
  publicBaseUrl = process.env.PUBLIC_BASE_URL,
): StreamStartInlineKeyboard {
  const rows: StreamStartInlineKeyboard["inline_keyboard"] = [
    [{ text: STREAM_START_WATCH_BUTTON_TEXT, url: KICK_STREAM_WATCH_URL }],
  ];
  const tasksUrl = resolveTasksWebAppUrl(publicBaseUrl);
  if (tasksUrl) {
    rows.push([
      {
        text: STREAM_START_TASKS_BUTTON_TEXT,
        web_app: { url: tasksUrl },
      },
    ]);
  }
  return { inline_keyboard: rows };
}

export function streamStartJobIdempotencyKey(
  sessionId: string,
  telegramUserId: bigint | number | string,
): string {
  return `kick:stream-start:${sessionId}:${String(telegramUserId)}`;
}

export function streamStartSendPayload(
  chatId: number,
  publicBaseUrl = process.env.PUBLIC_BASE_URL,
): Record<string, unknown> {
  return {
    chat_id: chatId,
    text: STREAM_START_NOTICE_HTML,
    parse_mode: "HTML",
    reply_markup: streamStartReplyMarkup(publicBaseUrl),
    disable_web_page_preview: false,
  };
}

export async function enqueueKickStreamStartBroadcastIn(
  tx: GiftbotTx,
  input: {
    sessionId: string;
    publicBaseUrl?: string;
  },
): Promise<number> {
  const recipients = await tx
    .select({
      telegramUserId: telegramAccounts.telegramUserId,
    })
    .from(telegramAccounts)
    .innerJoin(users, eq(users.id, telegramAccounts.userId))
    .where(
      and(
        eq(telegramAccounts.isActive, true),
        eq(users.status, "active"),
        isNull(users.deletedAt),
      ),
    );

  let created = 0;
  for (const recipient of recipients) {
    const chatId = Number(recipient.telegramUserId);
    const inserted = await tx
      .insert(jobs)
      .values({
        type: "telegram.send_message",
        owner: "bot",
        payload: streamStartSendPayload(chatId, input.publicBaseUrl),
        idempotencyKey: streamStartJobIdempotencyKey(
          input.sessionId,
          recipient.telegramUserId,
        ),
      })
      .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] })
      .returning({ id: jobs.id });
    if (inserted[0]) {
      created += 1;
    }
  }
  return created;
}
