import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { auditExitCode, auditV1Store, type AuditInput } from "./audit.js";
import { applyV1Cutover, hashCanonicalReport, type ApplyFlags } from "./apply.js";
import { loadV1Store } from "./parse-store.js";
import { reportContainsSecretLeak } from "./report.js";

function argValue(flag: string, argv: string[]): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

function parseAdminIds(raw: string | undefined): bigint[] | undefined {
  if (!raw || !raw.trim()) {
    return undefined;
  }
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => BigInt(part));
}

export async function runCli(argv = process.argv): Promise<void> {
  if (argv.includes("--check")) {
    process.stdout.write(
      `${JSON.stringify({ level: "info", msg: "v1-cutover cli ok", runtime: false })}\n`,
    );
    return;
  }

  const storePath = argValue("--store", argv);
  if (!storePath) {
    throw new Error(
      "usage: node dist/main.js --store <store.json> [--uploads <dir>] [--report out.json] [--apply ...]",
    );
  }
  const uploads = argValue("--uploads", argv);
  const store = await loadV1Store(storePath);
  const auditInput: AuditInput = { store, storePath };
  if (uploads) {
    auditInput.uploadsRoot = uploads;
  }
  const adminIds = parseAdminIds(argValue("--admin-telegram-ids", argv));
  if (adminIds) {
    auditInput.adminTelegramIds = adminIds;
  }

  if (argv.includes("--apply")) {
    const flags: ApplyFlags = {
      apply: true,
      confirmApply: argv.includes("--confirm-apply"),
      confirmSourceSha256: argValue("--confirm-source-sha256", argv) ?? "",
      confirmReportSha256: argValue("--confirm-report-sha256", argv) ?? "",
      productionConfirm: argv.includes("--production-confirm"),
    };
    const databaseUrl = argValue("--database-url", argv);
    if (databaseUrl) {
      flags.databaseUrl = databaseUrl;
    }
    if (process.env.KICK_TOKEN_ENCRYPTION_KEY) {
      flags.kickTokenEncryptionKey = process.env.KICK_TOKEN_ENCRYPTION_KEY;
    }
    const uploadDir = argValue("--upload-dir", argv);
    if (uploadDir) {
      flags.uploadDir = uploadDir;
    }
    const result = await applyV1Cutover({
      audit: auditInput,
      flags,
    });
    const body = `${JSON.stringify(result.report, null, 2)}\n`;
    if (reportContainsSecretLeak(body)) {
      throw new Error("refusing to print report: secret-like fields detected");
    }
    process.stdout.write(body);
    return;
  }

  const report = await auditV1Store(auditInput);
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (reportContainsSecretLeak(body)) {
    throw new Error("refusing to print report: secret-like fields detected");
  }
  const out = argValue("--report", argv);
  if (out) {
    await writeFile(out, body, "utf8");
  }
  process.stdout.write(body);
  process.stderr.write(
    `${JSON.stringify({
      level: "info",
      msg: "v1-cutover audit summary",
      sourceSha256: report.source.sha256,
      reportSha256: hashCanonicalReport(report),
      users: report.users,
      wallet: report.wallet,
      gram: report.gram,
      blocking: report.blockingIssues.length,
      warnings: report.warnings.length,
      legacyOnly: report.legacyOnly.length,
      fileSha256: createHash("sha256").update(body).digest("hex"),
    })}\n`,
  );
  process.exit(auditExitCode(report));
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  import.meta.url === pathToFileURL(path.resolve(entry)).href;

if (isMain) {
  await runCli();
}
