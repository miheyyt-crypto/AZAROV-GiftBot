const TELEGRAM_UPDATE_TYPES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "inline_query",
  "chosen_inline_result",
  "callback_query",
  "shipping_query",
  "pre_checkout_query",
  "poll",
  "poll_answer",
  "my_chat_member",
  "chat_member",
  "chat_join_request",
] as const;

export type TelegramFrom = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  is_premium?: boolean;
};

export type TelegramChat = {
  id: number;
};

export type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: TelegramChat;
    text?: string;
    from?: TelegramFrom;
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: TelegramFrom;
    message?: { chat: TelegramChat; message_id: number; caption?: string };
  };
};

export function telegramEventType(body: Record<string, unknown>): string {
  for (const key of TELEGRAM_UPDATE_TYPES) {
    if (key in body) {
      return key;
    }
  }
  return "update";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readFrom(value: unknown): TelegramFrom | undefined {
  const row = asRecord(value);
  if (!row || typeof row.id !== "number") {
    return undefined;
  }
  return {
    id: row.id,
    ...(typeof row.username === "string" ? { username: row.username } : {}),
    ...(typeof row.first_name === "string" ? { first_name: row.first_name } : {}),
    ...(typeof row.last_name === "string" ? { last_name: row.last_name } : {}),
    ...(typeof row.language_code === "string"
      ? { language_code: row.language_code }
      : {}),
    ...(typeof row.is_premium === "boolean"
      ? { is_premium: row.is_premium }
      : {}),
  };
}

function readChat(value: unknown): TelegramChat | undefined {
  const row = asRecord(value);
  if (!row || typeof row.id !== "number") {
    return undefined;
  }
  return { id: row.id };
}

export function readTelegramUpdate(payload: unknown): TelegramUpdate {
  const body = asRecord(payload);
  if (!body || typeof body.update_id !== "number") {
    throw new Error("telegram update_id is required");
  }

  const messageRow = asRecord(body.message);
  const callbackRow = asRecord(body.callback_query);
  const messageChat = messageRow ? readChat(messageRow.chat) : undefined;
  const messageFrom = messageRow ? readFrom(messageRow.from) : undefined;
  const callbackFrom = callbackRow ? readFrom(callbackRow.from) : undefined;
  const callbackMessage = callbackRow
    ? asRecord(callbackRow.message)
    : undefined;
  const callbackChat = callbackMessage ? readChat(callbackMessage.chat) : undefined;
  const callbackId =
    typeof callbackRow?.id === "string" ? callbackRow.id : undefined;
  const callbackData =
    typeof callbackRow?.data === "string" ? callbackRow.data : undefined;
  const callbackMessageId =
    typeof callbackMessage?.message_id === "number"
      ? callbackMessage.message_id
      : undefined;
  const callbackCaption =
    typeof callbackMessage?.caption === "string"
      ? callbackMessage.caption
      : undefined;

  return {
    update_id: body.update_id,
    ...(messageRow && messageChat
      ? {
          message: {
            chat: messageChat,
            ...(typeof messageRow.text === "string"
              ? { text: messageRow.text }
              : {}),
            ...(messageFrom ? { from: messageFrom } : {}),
          },
        }
      : {}),
    ...(callbackRow && callbackId
      ? {
          callback_query: {
            id: callbackId,
            ...(callbackData ? { data: callbackData } : {}),
            ...(callbackFrom ? { from: callbackFrom } : {}),
            ...(callbackChat && callbackMessageId !== undefined
              ? {
                  message: {
                    chat: callbackChat,
                    message_id: callbackMessageId,
                    ...(callbackCaption ? { caption: callbackCaption } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

export function parseStartCommand(text: string | undefined): {
  isStart: boolean;
  payload?: string;
} {
  if (!text) {
    return { isStart: false };
  }
  const match = /^\/start(?:@\S+)?(?:\s+(.+))?$/.exec(text.trim());
  if (!match) {
    return { isStart: false };
  }
  const payload = match[1]?.trim();
  return payload ? { isStart: true, payload } : { isStart: true };
}

export function parseAdminCommand(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  return /^\/admin(?:@\S+)?$/.test(text.trim());
}
