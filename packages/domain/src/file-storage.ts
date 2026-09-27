import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { WelvuraInvalidFileError } from "./errors.js";

export const SUBMISSION_MAX_BYTES = 10 * 1024 * 1024;
export const SUBMISSION_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const GIVEAWAY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const GIVEAWAY_IMAGE_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const GIVEAWAY_IMAGE_URL_RE =
  /^\/giveaways\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

export const BROADCAST_IMAGE_MAX_BYTES = GIVEAWAY_IMAGE_MAX_BYTES;
export const BROADCAST_IMAGE_ALLOWED_MIME = GIVEAWAY_IMAGE_ALLOWED_MIME;
export const BROADCAST_PHOTO_KEY_RE =
  /^broadcasts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;
export const BROADCAST_IMAGE_URL_RE =
  /^\/broadcasts\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

export type StoredSubmissionFile = {
  storageKey: string;
  contentType: string;
  byteSize: number;
  absolutePath: string;
};

export type SubmissionFileStorage = {
  put(input: {
    userId: string;
    contentType: string;
    bytes: Buffer;
    originalFilename?: string;
  }): Promise<StoredSubmissionFile>;
  resolvePath(storageKey: string): string;
  delete(storageKey: string): Promise<void>;
};

function assertImage(contentType: string, byteSize: number): void {
  if (!SUBMISSION_ALLOWED_MIME.has(contentType)) {
    throw new WelvuraInvalidFileError("unsupported image type");
  }
  if (byteSize <= 0 || byteSize > SUBMISSION_MAX_BYTES) {
    throw new WelvuraInvalidFileError("image exceeds size limit");
  }
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "jpg";
  }
}

export type GiveawayImageStorage = {
  put(input: {
    contentType: string;
    bytes: Buffer;
  }): Promise<{ imageUrl: string; storageKey: string; absolutePath: string }>;
  resolvePathFromPublicUrl(imageUrl: string): string;
};

export type BroadcastImageStorage = {
  put(input: {
    contentType: string;
    bytes: Buffer;
  }): Promise<{ imageUrl: string; storageKey: string; absolutePath: string }>;
  resolvePath(storageKey: string): string;
  resolvePathFromPublicUrl(imageUrl: string): string;
};

function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function assertInsideRoot(root: string, absolutePath: string): void {
  const rel = relative(root, absolutePath);
  if (!rel || rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new WelvuraInvalidFileError("path traversal rejected");
  }
}

function assertGiveawayImage(contentType: string, bytes: Buffer): string {
  const sniffed = sniffImageMime(bytes);
  if (!sniffed || !GIVEAWAY_IMAGE_ALLOWED_MIME.has(sniffed)) {
    throw new WelvuraInvalidFileError("unsupported image type");
  }
  if (contentType !== sniffed) {
    throw new WelvuraInvalidFileError("image type mismatch");
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > GIVEAWAY_IMAGE_MAX_BYTES) {
    throw new WelvuraInvalidFileError("image exceeds size limit");
  }
  return sniffed;
}

export function createGiveawayImageStorage(rootDir: string): GiveawayImageStorage {
  const root = resolve(rootDir);
  return {
    async put(input) {
      const contentType = assertGiveawayImage(input.contentType, input.bytes);
      const key = `giveaways/${randomUUID()}.${extensionFor(contentType)}`;
      const absolutePath = join(root, key);
      if (key.includes("..")) {
        throw new WelvuraInvalidFileError("path traversal rejected");
      }
      assertInsideRoot(root, absolutePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, input.bytes);
      const imageUrl = `/giveaways/media/${key.slice("giveaways/".length)}`;
      return { imageUrl, storageKey: key, absolutePath };
    },
    resolvePathFromPublicUrl(imageUrl) {
      if (!GIVEAWAY_IMAGE_URL_RE.test(imageUrl)) {
        throw new WelvuraInvalidFileError("unsafe storage key");
      }
      const file = imageUrl.slice("/giveaways/media/".length);
      const key = `giveaways/${file}`;
      const absolutePath = join(root, key);
      assertInsideRoot(root, absolutePath);
      return absolutePath;
    },
  };
}

export function createBroadcastImageStorage(rootDir: string): BroadcastImageStorage {
  const root = resolve(rootDir);
  return {
    async put(input) {
      const contentType = assertGiveawayImage(input.contentType, input.bytes);
      const key = `broadcasts/${randomUUID()}.${extensionFor(contentType)}`;
      const absolutePath = join(root, key);
      if (key.includes("..")) {
        throw new WelvuraInvalidFileError("path traversal rejected");
      }
      assertInsideRoot(root, absolutePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, input.bytes);
      const imageUrl = `/broadcasts/media/${key.slice("broadcasts/".length)}`;
      return { imageUrl, storageKey: key, absolutePath };
    },
    resolvePath(storageKey) {
      if (!BROADCAST_PHOTO_KEY_RE.test(storageKey)) {
        throw new WelvuraInvalidFileError("unsafe storage key");
      }
      const absolutePath = join(root, storageKey);
      assertInsideRoot(root, absolutePath);
      return absolutePath;
    },
    resolvePathFromPublicUrl(imageUrl) {
      if (!BROADCAST_IMAGE_URL_RE.test(imageUrl)) {
        throw new WelvuraInvalidFileError("unsafe storage key");
      }
      const file = imageUrl.slice("/broadcasts/media/".length);
      return this.resolvePath(`broadcasts/${file}`);
    },
  };
}

export function createLocalSubmissionFileStorage(
  rootDir: string,
): SubmissionFileStorage {
  const root = resolve(rootDir);
  return {
    async put(input) {
      assertImage(input.contentType, input.bytes.byteLength);
      const key = `welvura/${input.userId}/${randomUUID()}.${extensionFor(input.contentType)}`;
      if (key.includes("..") || key.startsWith("/") || key.includes("\\")) {
        throw new WelvuraInvalidFileError("unsafe storage key");
      }
      const absolutePath = join(root, key);
      if (!absolutePath.startsWith(root)) {
        throw new WelvuraInvalidFileError("path traversal rejected");
      }
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, input.bytes);
      return {
        storageKey: key,
        contentType: input.contentType,
        byteSize: input.bytes.byteLength,
        absolutePath,
      };
    },
    resolvePath(storageKey) {
      if (
        !storageKey ||
        storageKey.includes("..") ||
        storageKey.startsWith("/") ||
        storageKey.includes("\\")
      ) {
        throw new WelvuraInvalidFileError("unsafe storage key");
      }
      const absolutePath = join(root, storageKey);
      if (!absolutePath.startsWith(root)) {
        throw new WelvuraInvalidFileError("path traversal rejected");
      }
      return absolutePath;
    },
    async delete(storageKey) {
      try {
        await unlink(this.resolvePath(storageKey));
      } catch {
        // best-effort cleanup
      }
    },
  };
}
