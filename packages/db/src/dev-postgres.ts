import { access, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { cleanupOrphanGiftbotPgDirs } from "./cleanup-orphan-pg.js";

export type DevPostgres = {
  url: string;
  stop: () => Promise<void>;
};

const DEFAULT_PORT = 55432;

/** Fixed port for `pnpm dev:local` persistent embedded Postgres (not Docker 5433). */
export const LOCAL_QA_PG_PORT = 55433;

async function canConnect(url: string): Promise<boolean> {
  const sql = postgres(url, { max: 1, connect_timeout: 3 });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export async function probeDatabaseUrl(url: string): Promise<boolean> {
  return canConnect(url);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Disposable embedded Postgres for tests/load (wipes data dir on start/stop).
 * Prefer DATABASE_URL when already reachable unless forceEmbedded.
 */
export async function startDevPostgres(options?: {
  port?: number;
  forceEmbedded?: boolean;
}): Promise<DevPostgres> {
  const existing = process.env.DATABASE_URL;
  // Tests must never attach to a live QA/dev DATABASE_URL (e.g. :55433).
  const forceEmbedded =
    options?.forceEmbedded === true || process.env.NODE_ENV === "test";
  if (!forceEmbedded && existing && (await canConnect(existing))) {
    return {
      url: existing,
      stop: async () => undefined,
    };
  }

  const port = options?.port ?? DEFAULT_PORT;
  // Prefer GIFTBOT_PG_DIR when set (existing load harness config); else os.tmpdir().
  const rootDir = process.env.GIFTBOT_PG_DIR?.trim() || os.tmpdir();
  // Opportunistic cleanup of orphaned giftbot-pg-* dirs left by crashed/killed tests.
  await cleanupOrphanGiftbotPgDirs([rootDir, os.tmpdir()]).catch(() => undefined);
  const databaseDir = path.join(
    rootDir,
    `giftbot-pg-${process.pid}${port === DEFAULT_PORT ? "" : `-${String(port)}`}`,
  );
  await rm(databaseDir, { recursive: true, force: true });

  // Windows locales often initdb as WIN1251, which cannot store U+20BD (₽).
  // Force a UTF-8 cluster so Shop catalog titles and Cyrillic payloads work in tests.
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "giftbot",
    password: "giftbot",
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-collate=C", "--lc-ctype=C"],
    onLog: () => undefined,
  });

  await pg.initialise();
  await pg.start();

  const admin = postgres(
    `postgresql://giftbot:giftbot@127.0.0.1:${String(port)}/postgres`,
    {
      max: 1,
      prepare: false,
      connection: { client_encoding: "UTF8" },
    },
  );
  try {
    await admin.unsafe(
      `CREATE DATABASE giftbot WITH ENCODING 'UTF8' TEMPLATE template0`,
    );
  } finally {
    await admin.end({ timeout: 2 });
  }

  const url = `postgresql://giftbot:giftbot@127.0.0.1:${String(port)}/giftbot`;
  process.env.DATABASE_URL = url;
  process.env.PGCLIENTENCODING = "UTF8";

  return {
    url,
    async stop() {
      await pg.stop();
      await rm(databaseDir, { recursive: true, force: true });
    },
  };
}

/**
 * Persistent embedded Postgres for local browser QA (`pnpm dev:local`).
 * Reuses cluster under `databaseDir` across restarts; stop does not delete data.
 */
export async function startPersistentLocalPostgres(options: {
  databaseDir: string;
  port?: number;
}): Promise<DevPostgres> {
  const port = options.port ?? LOCAL_QA_PG_PORT;
  const databaseDir = path.resolve(options.databaseDir);
  await mkdir(databaseDir, { recursive: true });

  const url = `postgresql://giftbot:giftbot@127.0.0.1:${String(port)}/giftbot`;
  if (await canConnect(url)) {
    process.env.DATABASE_URL = url;
    process.env.PGCLIENTENCODING = "UTF8";
    return {
      url,
      stop: async () => undefined,
    };
  }

  const alreadyInit = await pathExists(path.join(databaseDir, "PG_VERSION"));
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "giftbot",
    password: "giftbot",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-collate=C", "--lc-ctype=C"],
    onLog: () => undefined,
  });

  if (!alreadyInit) {
    await pg.initialise();
  }
  await pg.start();

  const admin = postgres(
    `postgresql://giftbot:giftbot@127.0.0.1:${String(port)}/postgres`,
    {
      max: 1,
      prepare: false,
      connection: { client_encoding: "UTF8" },
    },
  );
  try {
    const rows = (await admin.unsafe(
      `select exists(select 1 from pg_database where datname = 'giftbot') as exists`,
    )) as Array<{ exists: boolean }>;
    if (!rows[0]?.exists) {
      await admin.unsafe(
        `CREATE DATABASE giftbot WITH ENCODING 'UTF8' TEMPLATE template0`,
      );
    }
  } finally {
    await admin.end({ timeout: 2 });
  }

  process.env.DATABASE_URL = url;
  process.env.PGCLIENTENCODING = "UTF8";

  return {
    url,
    async stop() {
      // Keep data directory for the next `pnpm dev:local` session.
      await pg.stop();
    },
  };
}
