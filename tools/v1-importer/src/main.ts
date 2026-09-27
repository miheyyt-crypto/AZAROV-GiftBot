import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createDb, runMigrations } from "@giftbot/db";
import { loadDatabaseUrl } from "@giftbot/config";
import { importV1Users, planV1Import } from "./import.js";
import { parseImportMode, parseV1Export } from "./parse.js";

function argValue(flag: string, argv: string[]): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

export async function runCli(argv = process.argv): Promise<void> {
  if (argv.includes("--check")) {
    process.stdout.write(
      `${JSON.stringify({ level: "info", msg: "v1-importer cli ok", runtime: false })}\n`,
    );
    return;
  }

  const file = argValue("--file", argv);
  if (!file) {
    throw new Error(
      "usage: node dist/main.js --file <giftbot-v1-export.json> [--mode snapshot|full_history] [--dry-run]",
    );
  }

  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  const source = parseV1Export(raw);
  const dryRun = argv.includes("--dry-run");
  const mode = parseImportMode(argValue("--mode", argv));

  const report = dryRun
    ? planV1Import(source, mode)
    : await (async () => {
        const url = loadDatabaseUrl();
        await runMigrations(url);
        const handle = createDb(url);
        try {
          return await importV1Users(handle.db, source, { mode, dryRun: false });
        } finally {
          await handle.sql.end({ timeout: 5 });
        }
      })();

  process.stdout.write(
    `${JSON.stringify({ level: "info", msg: "v1 import report", ...report })}\n`,
  );
  if (report.conflicts > 0 || !report.reconcileOk) {
    process.exitCode = 2;
  }
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  import.meta.url === pathToFileURL(path.resolve(entry)).href;

if (isMain) {
  await runCli();
}
