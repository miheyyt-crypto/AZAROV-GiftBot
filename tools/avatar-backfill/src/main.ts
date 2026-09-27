import { pathToFileURL } from "node:url";
import { runAvatarBackfill } from "./backfill.js";
import { loadFrozenV1Store } from "./store.js";

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
      `${JSON.stringify({ level: "info", msg: "avatar-backfill cli ok", runtime: false })}\n`,
    );
    return;
  }

  const storePath = argValue("--store", argv);
  if (!storePath) {
    throw new Error(
      "usage: node dist/main.js --store <store.json> [--database-url <url>] [--apply --confirm-apply]",
    );
  }
  const store = await loadFrozenV1Store(storePath);
  const databaseUrl = argValue("--database-url", argv) ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL or --database-url is required");
  }
  const report = await runAvatarBackfill({
    store,
    flags: {
      apply: argv.includes("--apply"),
      confirmApply: argv.includes("--confirm-apply"),
      databaseUrl,
    },
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
