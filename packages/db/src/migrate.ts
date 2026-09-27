import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDatabaseUrl } from "@giftbot/config";
import { createSql } from "./client.js";

const MIGRATE_LOCK = 872_514;

function log(msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ level: "info", msg, process: "db-migrate", ...extra })}\n`,
  );
}

export async function runMigrations(
  databaseUrl = loadDatabaseUrl(),
): Promise<void> {
  const sql = createSql(databaseUrl);
  const migrationsFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../drizzle",
  );

  try {
    await sql`select pg_advisory_lock(${MIGRATE_LOCK})`;
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsFolder))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const already = await sql`
        select 1 from schema_migrations where id = ${file}
      `;
      if (already.length > 0) {
        log("migration already applied", { file });
        continue;
      }

      const contents = await readFile(path.join(migrationsFolder, file), "utf8");
      await sql.unsafe(contents);
      await sql`insert into schema_migrations (id) values (${file})`;
      log("migration applied", { file });
    }
  } finally {
    await sql`select pg_advisory_unlock(${MIGRATE_LOCK})`;
    await sql.end({ timeout: 5 });
  }
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  import.meta.url === pathToFileURL(path.resolve(entry)).href;

if (isMain) {
  await runMigrations();
}
