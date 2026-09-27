import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { startDevPostgres } from "./dev-postgres.js";
import { runMigrations } from "./migrate.js";

function log(msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ level: "info", msg, process: "db-restore-drill", ...extra })}\n`,
  );
}

function adminUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

function restoreUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/giftbot_restore";
  return url.toString();
}

export async function runRestoreDrill(): Promise<void> {
  const handle = await startDevPostgres();

  try {
    await runMigrations(handle.url);

    const live = postgres(handle.url, { max: 1 });
    try {
      await live`
        insert into app_config (key, value)
        values ('restore_probe', '"phase-2-restore-drill"'::jsonb)
        on conflict (key) do update set value = excluded.value
      `;
    } finally {
      await live.end({ timeout: 5 });
    }

    const admin = postgres(adminUrl(handle.url), { max: 1 });
    try {
      await admin.unsafe("drop database if exists giftbot_restore with (force)");
      await admin.unsafe("create database giftbot_restore template giftbot");
    } finally {
      await admin.end({ timeout: 5 });
    }

    const restored = postgres(restoreUrl(handle.url), { max: 1 });
    try {
      const probe = await restored`
        select value #>> '{}' as note
        from app_config
        where key = 'restore_probe'
      `;
      if (probe[0]?.note !== "phase-2-restore-drill") {
        throw new Error("restore drill did not recover probe row");
      }

      const forbidden = await restored`
        select tablename
        from pg_tables
        where schemaname = 'public'
          and tablename in ('kick_events', 'telegram_events', 'store')
      `;
      if (forbidden.length > 0) {
        throw new Error("restore contains forbidden payload tables");
      }

      const inbound = await restored`
        select 1
        from pg_tables
        where schemaname = 'public' and tablename = 'inbound_events'
      `;
      if (inbound.length !== 1) {
        throw new Error("restore is missing inbound_events");
      }
    } finally {
      await restored.end({ timeout: 5 });
    }

    log("restore drill ok", { method: "create database template" });
  } finally {
    await handle.stop();
  }
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  import.meta.url === pathToFileURL(path.resolve(entry)).href;

if (isMain) {
  await runRestoreDrill();
}
