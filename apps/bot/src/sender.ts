import { Bot, InputFile } from "grammy";

export type TelegramInlineButton =
  | { text: string; url: string }
  | { text: string; web_app: { url: string } }
  | { text: string; callback_data: string };

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineButton[][];
};

export type TelegramMessageSendOptions = {
  replyMarkup?: TelegramInlineKeyboardMarkup;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  disableWebPagePreview?: boolean;
};

export type TelegramPhotoSend = {
  photoPath: string;
  caption?: string;
  parseMode?: TelegramMessageSendOptions["parseMode"];
  replyMarkup?: TelegramInlineKeyboardMarkup;
};

export type TelegramSender = {
  sendMessage(
    chatId: number | string,
    text: string,
    options?: TelegramMessageSendOptions,
  ): Promise<void>;
  sendPhoto(chatId: number | string, photo: TelegramPhotoSend): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
  editMessageCaption(
    chatId: number | string,
    messageId: number,
    caption: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
  ): Promise<void>;
};

export function createGrammySender(token: string): TelegramSender {
  const bot = new Bot(token, {
    client: {
      // Finite Telegram HTTP timeout (seconds). Avoids hung outbound forever.
      timeoutSeconds: 15,
    },
  });
  return {
    async sendMessage(chatId, text, options) {
      const extra: {
        reply_markup?: TelegramInlineKeyboardMarkup;
        parse_mode?: TelegramMessageSendOptions["parseMode"];
        link_preview_options?: { is_disabled: true };
      } = {};
      if (options?.replyMarkup) {
        extra.reply_markup = options.replyMarkup;
      }
      if (options?.parseMode) {
        extra.parse_mode = options.parseMode;
      }
      if (options?.disableWebPagePreview === true) {
        extra.link_preview_options = { is_disabled: true };
      }
      if (Object.keys(extra).length === 0) {
        await bot.api.sendMessage(chatId, text);
        return;
      }
      await bot.api.sendMessage(
        chatId,
        text,
        extra as Parameters<Bot["api"]["sendMessage"]>[2],
      );
    },
    async sendPhoto(chatId, photo) {
      const file = new InputFile(photo.photoPath);
      const extra: {
        caption?: string;
        parse_mode?: TelegramMessageSendOptions["parseMode"];
        reply_markup?: TelegramInlineKeyboardMarkup;
      } = {};
      if (photo.caption) {
        extra.caption = photo.caption;
      }
      if (photo.parseMode) {
        extra.parse_mode = photo.parseMode;
      }
      if (photo.replyMarkup) {
        extra.reply_markup = photo.replyMarkup;
      }
      await bot.api.sendPhoto(
        chatId,
        file,
        extra as Parameters<Bot["api"]["sendPhoto"]>[2],
      );
    },
    async answerCallbackQuery(callbackQueryId, text) {
      if (text) {
        await bot.api.answerCallbackQuery(callbackQueryId, { text });
        return;
      }
      await bot.api.answerCallbackQuery(callbackQueryId);
    },
    async editMessageCaption(chatId, messageId, caption, replyMarkup) {
      await bot.api.editMessageCaption(chatId, messageId, {
        caption,
        reply_markup: replyMarkup ?? { inline_keyboard: [] },
      });
    },
  };
}
