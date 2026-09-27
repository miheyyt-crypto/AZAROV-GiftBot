import {
  createDb,
  type createSql,
} from "@giftbot/db";
import type * as schema from "@giftbot/db/schema";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type GiftbotDb = PostgresJsDatabase<typeof schema>;
export type GiftbotTx = Parameters<Parameters<GiftbotDb["transaction"]>[0]>[0];

export type DatabaseHandle = ReturnType<typeof createDb>;

export function openDatabase(url: string): DatabaseHandle {
  return createDb(url);
}

export type SqlClient = ReturnType<typeof createSql>;
