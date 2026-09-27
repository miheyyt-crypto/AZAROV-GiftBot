import postgres from "postgres";

export const BACKUP_RESTORE_PROBE_KEY = "restore_probe";
export const BACKUP_RESTORE_PROBE_VALUE = "phase-14-backup-restore";

export type LogicalBackup = {
  version: 1;
  app_config: { key: string; value_text: string }[];
};

function adminUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

export function databaseUrlForName(databaseUrl: string, name: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function dumpAppConfig(databaseUrl: string): Promise<LogicalBackup> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql<{ key: string; value_text: string }[]>`
      select key, value::text as value_text from app_config order by key
    `;
    return { version: 1, app_config: rows };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function restoreAppConfig(
  databaseUrl: string,
  backup: LogicalBackup,
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    for (const row of backup.app_config) {
      await sql`
        insert into app_config (key, value)
        values (${row.key}, ${sql.json(JSON.parse(row.value_text) as never)})
        on conflict (key) do update set value = excluded.value
      `;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function insertBackupRestoreProbe(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      insert into app_config (key, value)
      values (
        ${BACKUP_RESTORE_PROBE_KEY},
        ${sql.json(BACKUP_RESTORE_PROBE_VALUE)}
      )
      on conflict (key) do update set value = excluded.value
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function readBackupRestoreProbe(
  databaseUrl: string,
): Promise<string | undefined> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql<{ note: string }[]>`
      select value #>> '{}' as note
      from app_config
      where key = ${BACKUP_RESTORE_PROBE_KEY}
    `;
    return rows[0]?.note;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function recreateDatabase(
  sourceUrl: string,
  name: string,
): Promise<string> {
  const admin = postgres(adminUrl(sourceUrl), { max: 1 });
  try {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  return databaseUrlForName(sourceUrl, name);
}
