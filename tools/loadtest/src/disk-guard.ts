import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Abort local load if system drive free space is below this (bytes). */
export const LOADTEST_MIN_FREE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB

export type DiskSnapshot = {
  root: string;
  freeBytes: number;
  totalBytes: number;
};

export function readDiskFree(rootPath: string): DiskSnapshot {
  const root = path.parse(path.resolve(rootPath)).root;
  const st = fs.statfsSync(root);
  const freeBytes = Number(st.bfree) * Number(st.bsize);
  const totalBytes = Number(st.blocks) * Number(st.bsize);
  return { root, freeBytes, totalBytes };
}

export function assertDiskSpaceOrThrow(
  label: string,
  roots: string[],
  minFreeBytes = LOADTEST_MIN_FREE_BYTES,
): DiskSnapshot[] {
  const snaps: DiskSnapshot[] = [];
  for (const rootPath of roots) {
    const snap = readDiskFree(rootPath);
    snaps.push(snap);
    if (snap.freeBytes < minFreeBytes) {
      const freeGb = (snap.freeBytes / (1024 ** 3)).toFixed(2);
      const needGb = (minFreeBytes / (1024 ** 3)).toFixed(2);
      throw new Error(
        `LOADTEST_DISK_GUARD: abort at ${label}: ${snap.root} has ${freeGb} GiB free (need >= ${needGb} GiB)`,
      );
    }
  }
  return snaps;
}

export function monitorDiskDelta(
  before: DiskSnapshot[],
  after: DiskSnapshot[],
  label: string,
  maxDropBytes = 2 * 1024 * 1024 * 1024,
): string[] {
  const notes: string[] = [];
  for (const b of before) {
    const a = after.find((row) => row.root === b.root);
    if (!a) continue;
    const drop = b.freeBytes - a.freeBytes;
    if (drop > maxDropBytes) {
      notes.push(
        `LOADTEST_DISK_WARN: ${label} freedrop ${b.root} ${(drop / (1024 ** 3)).toFixed(2)} GiB`,
      );
    }
  }
  return notes;
}

export function tmpRootsForGuard(): string[] {
  return [os.tmpdir(), process.cwd()];
}
