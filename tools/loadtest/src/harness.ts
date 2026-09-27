import { createApiApp } from "@giftbot/api";
import {
  buildKickSignedMessage,
  buildSignedInitData,
  createAuthPolicy,
} from "@giftbot/auth";
import { runBotConsumer, type TelegramSender } from "@giftbot/bot";
import {
  cleanupOrphanGiftbotPgDirs,
  createDb,
  createSql,
  runMigrations,
  startDevPostgres,
} from "@giftbot/db";
import type { DevPostgres } from "@giftbot/db";
import { jobs } from "@giftbot/db/schema";
import type { GiftbotDb } from "@giftbot/domain";
import { createLogger, type StructuredLogger } from "@giftbot/observability";
import { createRateLimitPolicy } from "@giftbot/rate-limit";
import { runWorkerConsumer } from "@giftbot/worker";
import { and, eq, inArray } from "drizzle-orm";
import { constants, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDiskSpaceOrThrow,
  LOADTEST_MIN_FREE_BYTES,
} from "./disk-guard.js";
import type { LockSnapshot } from "./stats.js";

const LOADTEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
/** Existing harness path — do not relocate for this resume. */
const PG_DATA_ROOT = path.resolve(LOADTEST_ROOT, "../.pgdata");

export const LOADTEST_BOT_TOKEN = "123456:LOADTEST-BOT-TOKEN";
export const LOADTEST_WEBHOOK_SECRET = "loadtest-telegram-secret";

/**
 * Harness-only limiter so the ladder measures app/DB, not the
 * TEMPORARY_UNCONFIRMED default of 400 requests / 60s from one IP.
 */
export const LOADTEST_RATE_LIMIT = {
  status: "TEMPORARY_UNCONFIRMED",
  windowSeconds: 60,
  maxRequests: 10_000,
  webhookMaxRequests: 10_000,
} as const;

const quietLogger: StructuredLogger = {
  info() {},
  warn() {},
  error() {},
};

export type LoadHarness = {
  baseUrl: string;
  db: GiftbotDb;
  sql: ReturnType<typeof createSql>;
  observeSql: ReturnType<typeof createSql>;
  logger: StructuredLogger;
  dbPoolMax: number;
  kickPublicKeyPem: string;
  kickPrivateKeyPem: string;
  stop: () => Promise<void>;
};

export const LOADTEST_DB_POOL_MAX = 80;

export async function startLoadHarness(options?: {
  port?: number;
  forceEmbedded?: boolean;
  dbPoolMax?: number;
  rateLimitMax?: number;
}): Promise<LoadHarness> {
  assertDiskSpaceOrThrow(
    "harness-start",
    [os.tmpdir(), process.cwd()],
    LOADTEST_MIN_FREE_BYTES,
  );
  mkdirSync(PG_DATA_ROOT, { recursive: true });
  process.env.GIFTBOT_PG_DIR = PG_DATA_ROOT;
  await cleanupOrphanGiftbotPgDirs([PG_DATA_ROOT, os.tmpdir()]).catch(
    () => undefined,
  );

  const postgres: DevPostgres = await startDevPostgres({
    port: options?.port ?? 55450,
    forceEmbedded: options?.forceEmbedded ?? true,
  });
  const dbPoolMax = options?.dbPoolMax ?? LOADTEST_DB_POOL_MAX;
  const rateLimitMax = options?.rateLimitMax ?? LOADTEST_RATE_LIMIT.maxRequests;
  await runMigrations(postgres.url);
  const handle = createDb(postgres.url, { max: dbPoolMax });
  const observeSql = createSql(postgres.url, { max: 2 });
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
    const app = createApiApp({
    db: handle.db,
    authPolicy: createAuthPolicy(LOADTEST_BOT_TOKEN),
    webhook: {
      telegramSecret: LOADTEST_WEBHOOK_SECRET,
      kickPublicKeyPem: publicKey,
    },
    rateLimitPolicy: createRateLimitPolicy({
      windowSeconds: LOADTEST_RATE_LIMIT.windowSeconds,
      maxRequests: rateLimitMax,
      writeMaxRequests: rateLimitMax,
      authMaxRequests: rateLimitMax,
      webhookMaxRequests: LOADTEST_RATE_LIMIT.webhookMaxRequests,
    }),
    allowDevAuth: true,
    trustProxy: true,
    logger: quietLogger,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  const abort = new AbortController();
  const sender: TelegramSender = {
    async sendMessage() {},
    async sendPhoto() {},
    async answerCallbackQuery() {},
    async editMessageCaption() {},
  };
  // Consumers must not kill the harness on shutdown CONNECTION_ENDED.
  void runBotConsumer({
    db: handle.db,
    sender,
    lockedBy: "loadtest-bot",
    signal: abort.signal,
    idleMs: 20,
    logger: quietLogger,
  }).catch(() => undefined);
  void runWorkerConsumer({
    db: handle.db,
    lockedBy: "loadtest-worker",
    signal: abort.signal,
    idleMs: 20,
    logger: quietLogger,
  }).catch(() => undefined);

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    db: handle.db,
    sql: handle.sql,
    observeSql,
    dbPoolMax,
    kickPublicKeyPem: publicKey,
    kickPrivateKeyPem: privateKey,
    logger: createLogger("loadtest"),
    async stop() {
      abort.abort();
      // Let claim/fail loops observe abort before pools close.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await app.close().catch(() => undefined);
      await observeSql.end({ timeout: 5 }).catch(() => undefined);
      await handle.sql.end({ timeout: 5 }).catch(() => undefined);
      await postgres.stop().catch(() => undefined);
      await cleanupOrphanGiftbotPgDirs([PG_DATA_ROOT, os.tmpdir()]).catch(
        () => undefined,
      );
    },
  };
}

export function signKickPayload(
  privateKeyPem: string,
  messageId: string,
  timestamp: string,
  rawBody: string,
): string {
  return sign(
    "sha256",
    buildKickSignedMessage(messageId, timestamp, Buffer.from(rawBody)),
    {
      key: privateKeyPem,
      padding: constants.RSA_PKCS1_PADDING,
    },
  ).toString("base64");
}

export function signedInitData(telegramUserId: number): string {
  return buildSignedInitData(
    LOADTEST_BOT_TOKEN,
    { id: telegramUserId, first_name: "Load" },
    Math.floor(Date.now() / 1000),
  );
}

export async function readBackends(
  observeSql: ReturnType<typeof createSql>,
): Promise<number> {
  const rows = await observeSql<Array<{ n: number }>>`
    select count(*)::int as n
    from pg_stat_activity
    where datname = current_database()
  `;
  return rows[0]?.n ?? 0;
}

export async function readLocks(
  observeSql: ReturnType<typeof createSql>,
): Promise<LockSnapshot> {
  const rows = await observeSql<LockSnapshot[]>`
    select
      count(*) filter (where not granted)::int as waiting,
      count(*) filter (where granted)::int as granted
    from pg_locks
  `;
  return rows[0] ?? { waiting: 0, granted: 0 };
}

export async function countOpenBotJobs(db: GiftbotDb): Promise<number> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.owner, "bot"),
        inArray(jobs.status, ["pending", "processing", "failed"]),
      ),
    );
  return rows.length;
}

export async function waitForOpenBotJobs(
  db: GiftbotDb,
  timeoutMs: number,
): Promise<number> {
  const started = Date.now();
  let open = await countOpenBotJobs(db);
  while (open > 0 && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    open = await countOpenBotJobs(db);
  }
  return open;
}

export async function readyIsSelectOnly(baseUrl: string): Promise<boolean> {
  const response = await fetch(`${baseUrl}/health/ready`);
  const body = (await response.json()) as { status?: string };
  return response.ok && body.status === "ready";
}
