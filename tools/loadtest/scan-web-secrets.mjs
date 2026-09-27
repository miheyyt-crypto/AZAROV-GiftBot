/**
 * Scan production web dist for obvious server-only secret markers.
 * Does not print secret values — only marker hit counts / file names.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const dist = path.resolve("E:/AZAROV-GiftBot-V2.0/apps/web/dist");
const markers = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "KICK_CLIENT_SECRET",
  "KICK_TOKEN_ENCRYPTION_KEY",
  "DATABASE_URL",
  "ALLOW_DEV_AUTH",
  "postgresql://",
  "BEGIN PRIVATE KEY",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|css|html|map)$/i.test(name)) out.push(full);
  }
  return out;
}

const files = walk(dist);
const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const marker of markers) {
    if (text.includes(marker)) {
      hits.push({ file: path.relative(dist, file), marker });
    }
  }
}

const maps = files.filter((f) => f.endsWith(".map"));
console.log(
  JSON.stringify(
    {
      scannedFiles: files.length,
      sourceMapFiles: maps.length,
      sourceMapsPublic: maps.length > 0,
      secretMarkerHits: hits,
      ok: hits.length === 0,
    },
    null,
    2,
  ),
);
process.exit(hits.length === 0 ? 0 : 1);
