import path from "node:path";
import { pathToFileURL } from "node:url";
import { runValidation } from "./validate.js";

export async function runCli(): Promise<void> {
  const report = await runValidation();
  process.stdout.write(`${JSON.stringify({ level: "info", msg: "phase-16 validation", ...report })}\n`);
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  import.meta.url === pathToFileURL(path.resolve(entry)).href;

if (isMain) {
  await runCli();
}
