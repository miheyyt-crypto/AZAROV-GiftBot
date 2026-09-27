import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import type { GiftbotDb } from "@giftbot/domain";

export type BotHarness = {
  db: GiftbotDb;
  stop: () => Promise<void>;
};

export async function startBotHarness(): Promise<BotHarness> {
  const postgres: DevPostgres = await startDevPostgres({
    port: 55438,
    forceEmbedded: true,
  });
  await runMigrations(postgres.url);
  const handle = createDb(postgres.url);
  return {
    db: handle.db,
    async stop() {
      await handle.sql.end({ timeout: 5 });
      await postgres.stop();
    },
  };
}
