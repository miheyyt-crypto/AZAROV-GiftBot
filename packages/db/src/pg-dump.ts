import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createRequire } from "node:module";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const PG_DUMP = process.platform === "win32" ? "pg_dump.exe" : "pg_dump";
const PG_RESTORE = process.platform === "win32" ? "pg_restore.exe" : "pg_restore";

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function dataDirectory(databaseUrl: string): Promise<string | undefined> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql<{ data_directory: string }[]>`show data_directory`;
    return rows[0]?.data_directory;
  } catch {
    return undefined;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function candidatesFromDataDir(
  dataDir: string | undefined,
  file: string,
): Promise<string[]> {
  if (!dataDir) {
    return [];
  }
  return [
    path.join(dataDir, "bin", file),
    path.join(dataDir, "..", "bin", file),
    path.join(dataDir, "..", "..", "bin", file),
    path.join(dataDir, "..", "native", file),
  ];
}

function candidatesFromEmbeddedPackage(file: string): string[] {
  const packages = [
    "@embedded-postgres/windows-x64",
    "@embedded-postgres/linux-x64",
    "@embedded-postgres/linux-arm64",
    "@embedded-postgres/darwin-arm64",
    "@embedded-postgres/darwin-x64",
  ];
  const found: string[] = [];
  for (const name of packages) {
    try {
      const entry = require.resolve(`${name}/package.json`);
      const root = path.dirname(entry);
      found.push(path.join(root, "native", file));
      found.push(path.join(root, "native", "bin", file));
    } catch {
      // Platform package is absent on this host.
    }
  }
  return found;
}

export async function findPgTool(
  file: string,
  databaseUrl?: string,
): Promise<string | undefined> {
  const fromData = await candidatesFromDataDir(
    databaseUrl ? await dataDirectory(databaseUrl) : undefined,
    file,
  );
  for (const candidate of [...fromData, ...candidatesFromEmbeddedPackage(file)]) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export async function findPgDump(databaseUrl?: string): Promise<string | undefined> {
  return findPgTool(PG_DUMP, databaseUrl);
}

export async function findPgRestore(
  databaseUrl?: string,
): Promise<string | undefined> {
  return findPgTool(PG_RESTORE, databaseUrl);
}

export async function pgDumpCustom(
  databaseUrl: string,
  dumpFile: string,
): Promise<void> {
  const bin = await findPgDump(databaseUrl);
  if (!bin) {
    throw new Error("pg_dump binary was not found");
  }
  await execFileAsync(bin, [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    `--dbname=${databaseUrl}`,
    `--file=${dumpFile}`,
  ]);
}

export async function pgRestoreCustom(
  databaseUrl: string,
  dumpFile: string,
): Promise<void> {
  const bin = await findPgRestore(databaseUrl);
  if (!bin) {
    throw new Error("pg_restore binary was not found");
  }
  await execFileAsync(bin, [
    "--no-owner",
    "--no-privileges",
    `--dbname=${databaseUrl}`,
    dumpFile,
  ]);
}
