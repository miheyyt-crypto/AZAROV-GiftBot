import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { StreamGifInvalidFileError } from "./errors.js";
import { STREAM_GIF_STAGING_TTL_MS } from "./gif-inspect.js";

const EXT = "gif|jpe?g|png|webp|mp4|mov|webm";
const STAGING_KEY_RE = new RegExp(
  `^stream-gifs\\/staging\\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(${EXT})$`,
  "i",
);
const ACCEPTED_KEY_RE = new RegExp(
  `^stream-gifs\\/accepted\\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(${EXT})$`,
  "i",
);

export const STREAM_GIF_STORAGE_KEY_RE = new RegExp(
  `${STAGING_KEY_RE.source}|${ACCEPTED_KEY_RE.source}`,
  "i",
);

export type StreamGifFileStorage = {
  putStaging(input: {
    userId: string;
    bytes: Buffer;
    extension: string;
  }): Promise<{
    storageKey: string;
    absolutePath: string;
  }>;
  replaceStaging(input: {
    stagingKey: string;
    userId: string;
    bytes: Buffer;
    extension: string;
  }): Promise<{
    storageKey: string;
    absolutePath: string;
  }>;
  promoteAccepted(stagingKey: string, userId: string): Promise<{
    storageKey: string;
    absolutePath: string;
  }>;
  resolvePath(storageKey: string): string;
  delete(storageKey: string): Promise<void>;
  cleanupStaging(nowMs?: number, maxAgeMs?: number): Promise<number>;
};

function assertInsideRoot(root: string, absolutePath: string): void {
  const rel = relative(root, absolutePath);
  if (!rel || rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new StreamGifInvalidFileError("path traversal rejected");
  }
}

function extensionOf(storageKey: string): string {
  const dot = storageKey.lastIndexOf(".");
  return dot >= 0 ? storageKey.slice(dot + 1).toLowerCase() : "bin";
}

export function createStreamGifFileStorage(rootDir: string): StreamGifFileStorage {
  const root = resolve(rootDir);
  return {
    async putStaging(input) {
      const ext = input.extension.replace(/^\./, "").toLowerCase();
      const key = `stream-gifs/staging/${input.userId}/${randomUUID()}.${ext}`;
      if (!STAGING_KEY_RE.test(key)) {
        throw new StreamGifInvalidFileError("unsafe storage key");
      }
      const absolutePath = join(root, key);
      assertInsideRoot(root, absolutePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, input.bytes);
      return { storageKey: key, absolutePath };
    },
    async replaceStaging(input) {
      const stored = await this.putStaging({
        userId: input.userId,
        bytes: input.bytes,
        extension: input.extension,
      });
      if (input.stagingKey !== stored.storageKey) {
        await this.delete(input.stagingKey);
      }
      return stored;
    },
    async promoteAccepted(stagingKey, userId) {
      if (!STAGING_KEY_RE.test(stagingKey)) {
        throw new StreamGifInvalidFileError("unsafe storage key");
      }
      const from = join(root, stagingKey);
      assertInsideRoot(root, from);
      const key = `stream-gifs/accepted/${userId}/${randomUUID()}.${extensionOf(stagingKey)}`;
      if (!ACCEPTED_KEY_RE.test(key)) {
        throw new StreamGifInvalidFileError("unsafe storage key");
      }
      const to = join(root, key);
      assertInsideRoot(root, to);
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      return { storageKey: key, absolutePath: to };
    },
    resolvePath(storageKey) {
      if (!STREAM_GIF_STORAGE_KEY_RE.test(storageKey)) {
        throw new StreamGifInvalidFileError("unsafe storage key");
      }
      const absolutePath = join(root, storageKey);
      assertInsideRoot(root, absolutePath);
      return absolutePath;
    },
    async delete(storageKey) {
      try {
        await unlink(this.resolvePath(storageKey));
      } catch {
        // best-effort
      }
    },
    async cleanupStaging(nowMs = Date.now(), maxAgeMs = STREAM_GIF_STAGING_TTL_MS) {
      const stagingRoot = join(root, "stream-gifs", "staging");
      let removed = 0;
      let users: string[] = [];
      try {
        users = await readdir(stagingRoot);
      } catch {
        return 0;
      }
      for (const user of users) {
        const dir = join(stagingRoot, user);
        let names: string[] = [];
        try {
          names = await readdir(dir);
        } catch {
          continue;
        }
        for (const name of names) {
          const file = join(dir, name);
          try {
            const info = await stat(file);
            if (nowMs - info.mtimeMs >= maxAgeMs) {
              await unlink(file);
              removed += 1;
            }
          } catch {
            // concurrent delete
          }
        }
      }
      return removed;
    },
  };
}

export function resolveStreamGifStorageDir(uploadDir: string | undefined): string | undefined {
  if (!uploadDir || uploadDir.trim().length === 0) {
    return undefined;
  }
  return resolve(uploadDir.trim());
}
