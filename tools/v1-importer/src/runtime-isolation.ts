import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_APPS = ["api", "bot", "worker", "web"] as const;

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export async function assertRuntimeDoesNotImportV1(): Promise<void> {
  const root = repoRoot();
  for (const app of RUNTIME_APPS) {
    const pkg = JSON.parse(
      await readFile(path.join(root, "apps", app, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const deps = pkg.dependencies ?? {};
    if ("@giftbot/v1-importer" in deps) {
      throw new Error(`${app} must not depend on @giftbot/v1-importer`);
    }
  }

  const jobs = await readFile(
    path.join(root, "packages/jobs/src/types.ts"),
    "utf8",
  );
  if (jobs.includes("v1.import") || jobs.includes("v1Import")) {
    throw new Error("jobs must not own a V1 import job");
  }
}
