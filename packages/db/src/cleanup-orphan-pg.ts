import { readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Best-effort removal of leftover embedded-postgres cluster dirs named giftbot-pg-*.
 * Skips directories that still have a live postmaster.pid process (best-effort on Windows).
 * Does not touch production databases.
 */
export async function cleanupOrphanGiftbotPgDirs(
  roots: string[] = [os.tmpdir()],
): Promise<string[]> {
  const removed: string[] = [];
  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.startsWith("giftbot-pg-")) {
        continue;
      }
      const dir = path.join(root, name);
      try {
        const info = await stat(dir);
        if (!info.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
      try {
        await rm(dir, { recursive: true, force: true });
        removed.push(dir);
      } catch {
        // Directory may still be locked by a live postmaster; leave it.
      }
    }
  }
  return removed;
}
