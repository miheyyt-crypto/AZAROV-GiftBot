import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startDevPostgres } from "./dev-postgres.js";
import {
  BACKUP_RESTORE_PROBE_KEY,
  BACKUP_RESTORE_PROBE_VALUE,
  dumpAppConfig,
  insertBackupRestoreProbe,
  readBackupRestoreProbe,
  recreateDatabase,
  restoreAppConfig,
} from "./logical-backup.js";
import { runMigrations } from "./migrate.js";
import { findPgDump, findPgRestore, pgDumpCustom, pgRestoreCustom } from "./pg-dump.js";

export const BACKUP_RESTORE_DRILL_PORT = 55451;

export type BackupRestoreDrillResult = {
  methods: string[];
  probe: string;
};

function log(msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ level: "info", msg, process: "db-backup-restore-drill", ...extra })}\n`,
  );
}

async function assertProbe(url: string, method: string): Promise<void> {
  const note = await readBackupRestoreProbe(url);
  if (note !== BACKUP_RESTORE_PROBE_VALUE) {
    throw new Error(`${method} did not recover probe row`);
  }
}

export async function runBackupRestoreDrill(): Promise<BackupRestoreDrillResult> {
  const handle = await startDevPostgres({
    port: BACKUP_RESTORE_DRILL_PORT,
    forceEmbedded: true,
  });
  const methods: string[] = [];
  const tmp = await mkdtemp(path.join(os.tmpdir(), "giftbot-backup-"));

  try {
    await runMigrations(handle.url);
    await insertBackupRestoreProbe(handle.url);
    await assertProbe(handle.url, "live-insert");

    const logical = await dumpAppConfig(handle.url);
    if (
      !logical.app_config.some((row) => row.key === BACKUP_RESTORE_PROBE_KEY)
    ) {
      throw new Error(
        `logical dump missed probe: ${JSON.stringify(logical)}`,
      );
    }
    const logicalFile = path.join(tmp, "app_config.json");
    await writeFile(logicalFile, JSON.stringify(logical), "utf8");

    const logicalUrl = await recreateDatabase(handle.url, "giftbot_logical_restore");
    await runMigrations(logicalUrl);
    await restoreAppConfig(logicalUrl, logical);
    await assertProbe(logicalUrl, "logical-json");
    methods.push("logical-json");

    const dumpBin = await findPgDump(handle.url);
    const restoreBin = await findPgRestore(handle.url);
    if (dumpBin && restoreBin) {
      const dumpFile = path.join(tmp, "giftbot.dump");
      await pgDumpCustom(handle.url, dumpFile);
      const dumpUrl = await recreateDatabase(handle.url, "giftbot_pg_restore");
      await pgRestoreCustom(dumpUrl, dumpFile);
      await assertProbe(dumpUrl, "pg_dump-custom");
      methods.push("pg_dump-custom");
    }

    log("backup restore drill ok", { methods });
    return { methods, probe: BACKUP_RESTORE_PROBE_VALUE };
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await handle.stop();
  }
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  import.meta.url === pathToFileURL(path.resolve(entry)).href;

if (isMain) {
  await runBackupRestoreDrill();
}
