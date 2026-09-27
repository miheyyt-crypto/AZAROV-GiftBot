import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { applyDrainFile, type ApplyFlags } from "./apply.js";
import { drainExitCode, loadStoreFile, reportContainsSecretLeak, toDrainReport } from "./audit.js";

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
      `${JSON.stringify({ level: "info", msg: "v1-game-drain cli ok", runtime: false })}\n`,
    );
    return;
  }
  const storePath = argValue("--store", argv);
  if (!storePath) {
    throw new Error(
      "usage: node dist/main.js --store <store.json> [--report out.json] [--apply --confirm-drain --confirm-offline ...]",
    );
  }

  if (argv.includes("--apply")) {
    const flags: ApplyFlags = {
      apply: true,
      confirmDrain: argv.includes("--confirm-drain"),
      confirmOffline: argv.includes("--confirm-offline"),
      confirmSourceSha256: argValue("--confirm-source-sha256", argv) ?? "",
      backupPath: argValue("--backup-path", argv) ?? "",
      confirmBackupSha256: argValue("--confirm-backup-sha256", argv) ?? "",
    };
    const pidFile = argValue("--pid-file", argv);
    if (pidFile) {
      flags.pidFile = pidFile;
    }
    const result = await applyDrainFile(storePath, flags);
    const body = `${JSON.stringify(result.report, null, 2)}\n`;
    if (reportContainsSecretLeak(body)) {
      throw new Error("refusing to print report: secret-like fields detected");
    }
    process.stdout.write(body);
    process.exit(drainExitCode(result.report));
  }

  const loaded = await loadStoreFile(storePath);
  const report = toDrainReport(storePath, loaded.sha256, loaded.raw, "audit");
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (reportContainsSecretLeak(body)) {
    throw new Error("refusing to print report: secret-like fields detected");
  }
  const out = argValue("--report", argv);
  if (out) {
    await writeFile(out, body, "utf8");
  }
  process.stderr.write(
    `${JSON.stringify({
      level: "info",
      msg: "v1-game-drain audit summary",
      sourceSha256: report.source.sha256,
      financiallyBlocking: report.financiallyBlocking,
      totalUnresolvedStakes: report.totalUnresolvedStakes,
      totalCashouts: report.totalCashouts,
      totalRefunds: report.totalRefunds,
      blocking: report.blockingIssues.length,
    })}\n`,
  );
  process.stdout.write(body);
  process.exit(drainExitCode(report));
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  import.meta.url === pathToFileURL(path.resolve(entry)).href;

if (isMain) {
  await runCli();
}
