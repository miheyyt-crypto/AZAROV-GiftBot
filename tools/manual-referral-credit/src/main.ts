import { pathToFileURL } from "node:url";
import {
  parseManualReferralCreditArgs,
  runManualReferralCredit,
} from "./credit.js";

export async function runCli(argv = process.argv): Promise<void> {
  if (argv.includes("--check")) {
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        msg: "manual-referral-credit cli ok",
        runtime: false,
      })}\n`,
    );
    return;
  }

  const parsed = parseManualReferralCreditArgs(argv);
  if (!parsed.username || parsed.amount === undefined || !parsed.databaseUrl) {
    throw new Error(
      "usage: node dist/main.js --username <name> --amount <n> [--database-url <url>] [--apply --confirm-apply --idempotency-key <key>]",
    );
  }
  if (!Number.isInteger(parsed.amount) || parsed.amount <= 0) {
    throw new Error("--amount must be a positive integer");
  }

  const report = await runManualReferralCredit({
    username: parsed.username,
    amount: parsed.amount,
    apply: parsed.apply,
    confirmApply: parsed.confirmApply,
    databaseUrl: parsed.databaseUrl,
    ...(parsed.idempotencyKey ? { idempotencyKey: parsed.idempotencyKey } : {}),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  import.meta.url === pathToFileURL(entry).href;

if (isMain) {
  await runCli();
}
