import {
  assertProductionRuntimeEnv,
  loadEnv,
  resolveDbConnectTimeoutSeconds,
  resolveDbPoolMax,
} from "@giftbot/config";
import { createDb } from "@giftbot/db";
import {
  createHttpKickOAuthClient,
  parseTokenEncryptionKey,
} from "@giftbot/domain";
import { createLogger, createMetrics } from "@giftbot/observability";
import { sql } from "drizzle-orm";
import { runWorkerConsumer } from "./consume.js";
import { close, createWorkerHealthServer, listen } from "./health.js";
import type { WorkerJobDeps } from "./process-job.js";

const env = loadEnv();
const processName = "worker" as const;
const logger = createLogger(processName);
const metrics = createMetrics();

function log(msg: string, extra: Record<string, unknown> = {}): void {
  logger.info(msg, extra);
}

async function shutdown(
  signal: string,
  server: ReturnType<typeof createWorkerHealthServer>,
  abort: AbortController,
  sql?: { end: (options: { timeout: number }) => Promise<void> },
): Promise<void> {
  log("shutting down", { signal });
  abort.abort();
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

  assertProductionRuntimeEnv(env, "worker");

  const poolMax = resolveDbPoolMax(env, "worker");
  const connectTimeout = resolveDbConnectTimeoutSeconds(env);
  const dbHandle = env.DATABASE_URL
    ? createDb(env.DATABASE_URL, { max: poolMax, connectTimeout })
    : undefined;
  const server = createWorkerHealthServer({
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

  process.once("SIGINT", () => {
    void shutdown("SIGINT", server, abort, dbHandle?.sql);
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM", server, abort, dbHandle?.sql);
  });

  await listen(server, env.WORKER_HEALTH_HOST, env.WORKER_HEALTH_PORT);
  log("live health listening", {
    host: env.WORKER_HEALTH_HOST,
    port: env.WORKER_HEALTH_PORT,
    workerJobs: Boolean(dbHandle),
    dbPoolMax: poolMax,
  });

  if (dbHandle) {
    const deps: WorkerJobDeps = {};
    if (
      env.KICK_CLIENT_ID &&
      env.KICK_CLIENT_SECRET &&
      env.KICK_TOKEN_ENCRYPTION_KEY
    ) {
      deps.kickOAuth = createHttpKickOAuthClient({
        clientId: env.KICK_CLIENT_ID,
        clientSecret: env.KICK_CLIENT_SECRET,
      });
      deps.tokenKey = parseTokenEncryptionKey(env.KICK_TOKEN_ENCRYPTION_KEY);
    }
    void runWorkerConsumer({
      db: dbHandle.db,
      lockedBy: `worker:${process.pid}`,
      signal: abort.signal,
      deps,
      metrics,
      logger,
    }).catch((error) => {
      logger.error("worker consumer stopped", {
        error: error instanceof Error ? error.message : "unknown",
      });
    });
  }
}

await main();
