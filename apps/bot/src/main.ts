import {
  assertProductionRuntimeEnv,
  loadEnv,
  resolveDbConnectTimeoutSeconds,
  resolveDbPoolMax,
} from "@giftbot/config";
import { createDb } from "@giftbot/db";
import { createLogger, createMetrics } from "@giftbot/observability";
import { sql } from "drizzle-orm";
import { runBotConsumer } from "./consume.js";
import { close, createBotHealthServer, listen } from "./health.js";
import { startLongPolling, type LongPollHandle } from "./long-poll.js";
import { createGrammySender } from "./sender.js";

const env = loadEnv();
const processName = "bot" as const;
const logger = createLogger(processName);
const metrics = createMetrics();

function log(msg: string, extra: Record<string, unknown> = {}): void {
  logger.info(msg, extra);
}

async function shutdown(
  signal: string,
  server: ReturnType<typeof createBotHealthServer>,
  abort: AbortController,
  sql?: { end: (options: { timeout: number }) => Promise<void> },
  longPoll?: LongPollHandle,
): Promise<void> {
  log("shutting down", { signal });
  abort.abort();
  if (longPoll) {
    await longPoll.stop();
  }
  await close(server);
  if (sql) {
    await sql.end({ timeout: 5 });
  }
  process.exit(0);
}

async function main(): Promise<void> {
  if (process.argv.includes("--check")) {
    log("env skeleton ok");
    return;
  }

  assertProductionRuntimeEnv(env, "bot");

  const poolMax = resolveDbPoolMax(env, "bot");
  const connectTimeout = resolveDbConnectTimeoutSeconds(env);
  const dbHandle = env.DATABASE_URL
    ? createDb(env.DATABASE_URL, { max: poolMax, connectTimeout })
    : undefined;
  if (env.DATABASE_URL && !env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is required when DATABASE_URL is set");
  }
  if (
    env.TELEGRAM_LONG_POLLING === "true" &&
    (!dbHandle || !env.TELEGRAM_BOT_TOKEN)
  ) {
    throw new Error(
      "TELEGRAM_LONG_POLLING requires DATABASE_URL and TELEGRAM_BOT_TOKEN",
    );
  }

  const server = createBotHealthServer({
    metrics,
    ...(dbHandle
      ? {
          checkReady: async () => {
            await dbHandle.db.execute(sql`select 1`);
          },
        }
      : {}),
  });
  const abort = new AbortController();
  const sender = env.TELEGRAM_BOT_TOKEN
    ? createGrammySender(env.TELEGRAM_BOT_TOKEN)
    : undefined;
  const longPoll =
    env.TELEGRAM_LONG_POLLING === "true" && dbHandle && env.TELEGRAM_BOT_TOKEN
      ? startLongPolling(env.TELEGRAM_BOT_TOKEN, dbHandle.db)
      : undefined;

  process.once("SIGINT", () => {
    void shutdown("SIGINT", server, abort, dbHandle?.sql, longPoll);
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM", server, abort, dbHandle?.sql, longPoll);
  });

  await listen(server, env.BOT_HEALTH_HOST, env.BOT_HEALTH_PORT);
  log("live health listening", {
    host: env.BOT_HEALTH_HOST,
    port: env.BOT_HEALTH_PORT,
    botJobs: Boolean(dbHandle),
    longPolling: Boolean(longPoll),
    dbPoolMax: poolMax,
  });

  if (dbHandle && sender) {
    void runBotConsumer({
      db: dbHandle.db,
      sender,
      lockedBy: `bot:${process.pid}`,
      signal: abort.signal,
      metrics,
      logger,
    }).catch((error) => {
      logger.error("bot consumer stopped", {
        error: error instanceof Error ? error.message : "unknown",
      });
    });
  }
}

await main();
