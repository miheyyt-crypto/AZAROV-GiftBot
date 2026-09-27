import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import type { GiftbotDb } from "@giftbot/domain";

export type AuthHarness = {
  db: GiftbotDb;
  url: string;
  stop: () => Promise<void>;
};

export async function startAuthHarness(): Promise<AuthHarness> {
  const postgres: DevPostgres = await startDevPostgres({
    port: 55458,
    forceEmbedded: true,
  });
  await runMigrations(postgres.url);
  const handle = createDb(postgres.url);
  return {
    db: handle.db,
    url: postgres.url,
    async stop() {
      await handle.sql.end({ timeout: 5 });
      await postgres.stop();
    },
  };
}
