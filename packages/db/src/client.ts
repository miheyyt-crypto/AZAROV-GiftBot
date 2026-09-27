import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type SqlPoolOptions = {
  max?: number;
  /** Connection timeout in seconds (postgres.js). */
  connectTimeout?: number;
};

export function createSql(url: string, options: SqlPoolOptions = {}) {
  return postgres(url, {
    max: options.max ?? 20,
    prepare: false,
    connect_timeout: options.connectTimeout ?? 10,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connection: {
      client_encoding: "UTF8",
      application_name: "giftbot",
    },
  });
}

export function createDb(url: string, options: SqlPoolOptions = {}) {
  const sql = createSql(url, options);
  return {
    sql,
    db: drizzle(sql, { schema }),
  };
}
