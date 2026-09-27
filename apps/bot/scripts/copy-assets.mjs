import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "assets", "start-banner.jpg");
const toDir = path.join(root, "dist", "assets");
mkdirSync(toDir, { recursive: true });
cpSync(from, path.join(toDir, "start-banner.jpg"));
