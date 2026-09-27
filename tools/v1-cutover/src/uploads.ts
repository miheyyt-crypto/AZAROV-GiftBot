import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export type UploadAudit = {
  relativePath: string;
  exists: boolean;
  byteSize: number | null;
  sha256: string | null;
  contentType: string | null;
  traversal: boolean;
  missing: boolean;
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
  if (
    bytes.length >= 6 &&
    bytes.subarray(0, 6).toString("ascii") === "GIF87a"
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 6 &&
    bytes.subarray(0, 6).toString("ascii") === "GIF89a"
  ) {
    return "image/gif";
  }
  return null;
}

export function resolveInsideRoot(root: string, relativePath: string): string | null {
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    relativePath.split(/[/\\]/).includes("..")
  ) {
    return null;
  }
  const base = resolve(root);
  const absolute = resolve(join(base, relativePath));
  const rel = relative(base, absolute);
  if (!rel || rel.startsWith("..") || rel.split(sep).includes("..")) {
    return null;
  }
  return absolute;
}

export async function auditUploadFile(
  uploadsRoot: string,
  relativePath: string,
): Promise<UploadAudit> {
  const absolute = resolveInsideRoot(uploadsRoot, relativePath);
  if (!absolute) {
    return {
      relativePath,
      exists: false,
      byteSize: null,
      sha256: null,
      contentType: null,
      traversal: true,
      missing: true,
    };
  }
  try {
    const info = await stat(absolute);
    if (!info.isFile()) {
      return {
        relativePath,
        exists: false,
        byteSize: null,
        sha256: null,
        contentType: null,
        traversal: false,
        missing: true,
      };
    }
    const bytes = await readFile(absolute);
    return {
      relativePath,
      exists: true,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentType: sniffImageMime(bytes),
      traversal: false,
      missing: false,
    };
  } catch {
    return {
      relativePath,
      exists: false,
      byteSize: null,
      sha256: null,
      contentType: null,
      traversal: false,
      missing: true,
    };
  }
}

export function plannedStorageKey(kind: string, sha256: string, ext: string): string {
  return `cutover/${kind}/${sha256}.${ext}`;
}
