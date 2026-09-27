import { createDb, runMigrations, startDevPostgres } from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import type { GiftbotDb } from "./db.js";

export type DomainHarness = {
  db: GiftbotDb;
  url: string;
  stop: () => Promise<void>;
};

export async function startDomainHarness(): Promise<DomainHarness> {
  const postgres: DevPostgres = await startDevPostgres({
    port: 55457,
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
