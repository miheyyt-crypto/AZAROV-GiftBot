import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(
  process.execPath,
  [path.join(root, "packages/db/dist/backup-restore-drill.js")],
  { cwd: root, stdio: "inherit", env: process.env },
);

const [code] = await once(child, "exit");
if (code !== 0) {
  process.exit(code ?? 1);
}
