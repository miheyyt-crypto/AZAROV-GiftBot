import type { GiftbotDb } from "@giftbot/domain";
import { persistInboundAndEnqueue } from "@giftbot/jobs";
import { Bot, type Context } from "grammy";
import { telegramEventType } from "./telegram-update.js";

export type LongPollHandle = {
  stop: () => Promise<void>;
};

export function startLongPolling(
  token: string,
  db: GiftbotDb,
): LongPollHandle {
  const bot = new Bot(token);
  bot.use(async (ctx: Context) => {
    const update = ctx.update;
    await persistInboundAndEnqueue(db, {
      provider: "telegram",
      eventType: telegramEventType(update as unknown as Record<string, unknown>),
      externalEventId: String(update.update_id),
      payload: update,
    });
  });
  void bot.start();
  return {
    async stop() {
      await bot.stop();
    },
  };
}
