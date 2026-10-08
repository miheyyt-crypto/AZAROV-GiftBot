import { StreamGifInvalidFileError } from "./errors.js";

export const STREAM_GIF_MAX_BYTES = 4 * 1024 * 1024;
/** JSON+base64 of a 4 MiB GIF is ~5.4 MiB; 8 MiB covers multipart too. */
export const STREAM_GIF_UPLOAD_BODY_MAX = 8 * 1024 * 1024;
export const STREAM_GIF_MAX_WIDTH = 1280;
export const STREAM_GIF_MAX_HEIGHT = 1280;
export const STREAM_GIF_MAX_FRAMES = 240;
export const STREAM_GIF_MAX_PIXELS_PER_FRAME =
  STREAM_GIF_MAX_WIDTH * STREAM_GIF_MAX_HEIGHT;
/** Caps expanded LZW output across all frames (VPS CPU/RAM). */
export const STREAM_GIF_MAX_DECODED_PIXELS = 16_777_216;
export const STREAM_GIF_LZW_MAX_MS = 400;
export const STREAM_GIF_STAGING_TTL_MS = 60 * 60 * 1000;
export const STREAM_GIF_VISIBLE_MS = 15_000;
export const STREAM_GIF_PRELOAD_MS = 8_000;
export const STREAM_GIF_MESSAGE = "GIF";
export const STREAM_GIF_SHOP_PRODUCT_CODE = "gif-stream";

export type InspectedGif = {
  width: number;
  height: number;
  frameCount: number;
};

export type InspectGifLimits = {
  now?: () => number;
  lzwMaxMs?: number;
  maxDecodedPixels?: number;
  maxPixelsPerFrame?: number;
};

function readU16(bytes: Buffer, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function skipSubBlocks(bytes: Buffer, offset: number): number {
  let i = offset;
  while (i < bytes.length) {
    const size = bytes[i]!;
    i += 1;
    if (size === 0) {
      return i;
    }
    i += size;
  }
  throw new StreamGifInvalidFileError("truncated GIF sub-blocks");
}

function decodeLzw(
  minCodeSize: number,
  data: Buffer,
  limits: {
    startedMs: number;
    now: () => number;
    lzwMaxMs: number;
    maxPerFrame: number;
    totalDecoded: { value: number };
    maxDecodedPixels: number;
  },
): number {
  if (minCodeSize < 2 || minCodeSize > 8) {
    throw new StreamGifInvalidFileError("invalid GIF LZW code size");
  }
  if (data.length === 0) {
    throw new StreamGifInvalidFileError("empty GIF image data");
  }
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoi + 1;
  const lengths = new Uint16Array(4096);
  for (let i = 0; i < clear; i += 1) {
    lengths[i] = 1;
  }
  let bitPos = 0;
  const bitLength = data.length * 8;
  const readCode = (): number => {
    if (bitPos + codeSize > bitLength) {
      throw new StreamGifInvalidFileError("truncated GIF LZW stream");
    }
    let code = 0;
    for (let i = 0; i < codeSize; i += 1) {
      const byte = data[bitPos >> 3]!;
      const bit = (byte >> (bitPos & 7)) & 1;
      code |= bit << i;
      bitPos += 1;
    }
    return code;
  };
  let prevLen = 0;
  let decoded = 0;
  let steps = 0;
  while (bitPos < bitLength) {
    steps += 1;
    if ((steps & 1023) === 0 && limits.now() - limits.startedMs > limits.lzwMaxMs) {
      throw new StreamGifInvalidFileError("GIF decode exceeded time limit");
    }
    const code = readCode();
    if (code === eoi) {
      if (decoded === 0) {
        throw new StreamGifInvalidFileError("GIF image produced no pixels");
      }
      limits.totalDecoded.value += decoded;
      if (limits.totalDecoded.value > limits.maxDecodedPixels) {
        throw new StreamGifInvalidFileError("GIF decoded pixel budget exceeded");
      }
      return decoded;
    }
    if (code === clear) {
      codeSize = minCodeSize + 1;
      nextCode = eoi + 1;
      prevLen = 0;
      continue;
    }
    let entryLen = 0;
    if (code < nextCode && lengths[code]! > 0) {
      entryLen = lengths[code]!;
    } else if (code === nextCode && prevLen > 0) {
      entryLen = prevLen + 1;
    } else {
      throw new StreamGifInvalidFileError("GIF LZW code is not decodable");
    }
    decoded += entryLen;
    if (decoded > limits.maxPerFrame) {
      throw new StreamGifInvalidFileError("GIF frame expanded past pixel limit");
    }
    if (prevLen > 0 && nextCode < 4096) {
      const nextLen = prevLen + 1;
      if (nextLen > 0xffff) {
        throw new StreamGifInvalidFileError("GIF LZW dictionary overflow");
      }
      lengths[nextCode] = nextLen;
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    }
    prevLen = entryLen;
  }
  if (decoded === 0) {
    throw new StreamGifInvalidFileError("GIF image produced no pixels");
  }
  limits.totalDecoded.value += decoded;
  if (limits.totalDecoded.value > limits.maxDecodedPixels) {
    throw new StreamGifInvalidFileError("GIF decoded pixel budget exceeded");
  }
  return decoded;
}

function collectImageData(bytes: Buffer, offset: number): { data: Buffer; next: number } {
  const minCodeSize = bytes[offset];
  if (minCodeSize === undefined) {
    throw new StreamGifInvalidFileError("truncated GIF image");
  }
  let i = offset + 1;
  const chunks: Buffer[] = [];
  while (i < bytes.length) {
    const size = bytes[i]!;
    i += 1;
    if (size === 0) {
      return { data: Buffer.concat(chunks), next: i };
    }
    if (i + size > bytes.length) {
      throw new StreamGifInvalidFileError("truncated GIF image data");
    }
    chunks.push(bytes.subarray(i, i + size));
    i += size;
  }
  throw new StreamGifInvalidFileError("truncated GIF image data");
}

export function inspectGif(bytes: Buffer, limits: InspectGifLimits = {}): InspectedGif {
  const now = limits.now ?? Date.now;
  const startedMs = now();
  const lzwMaxMs = limits.lzwMaxMs ?? STREAM_GIF_LZW_MAX_MS;
  const maxDecodedPixels = limits.maxDecodedPixels ?? STREAM_GIF_MAX_DECODED_PIXELS;
  const maxPixelsPerFrame = limits.maxPixelsPerFrame ?? STREAM_GIF_MAX_PIXELS_PER_FRAME;
  if (bytes.byteLength <= 0 || bytes.byteLength > STREAM_GIF_MAX_BYTES) {
    throw new StreamGifInvalidFileError("GIF exceeds size limit");
  }
  if (bytes.length < 13) {
    throw new StreamGifInvalidFileError("file is not a GIF");
  }
  const header = bytes.subarray(0, 6).toString("ascii");
  if (header !== "GIF87a" && header !== "GIF89a") {
    throw new StreamGifInvalidFileError("file is not a GIF");
  }
  const width = readU16(bytes, 6);
  const height = readU16(bytes, 8);
  if (width < 1 || height < 1) {
    throw new StreamGifInvalidFileError("GIF has invalid dimensions");
  }
  if (width > STREAM_GIF_MAX_WIDTH || height > STREAM_GIF_MAX_HEIGHT) {
    throw new StreamGifInvalidFileError("GIF resolution is too large");
  }
  const packed = bytes[10]!;
  let offset = 13;
  if ((packed & 0x80) !== 0) {
    const gctSize = 3 * (1 << ((packed & 7) + 1));
    offset += gctSize;
  }
  let frames = 0;
  const totalDecoded = { value: 0 };
  while (offset < bytes.length) {
    if (now() - startedMs > lzwMaxMs) {
      throw new StreamGifInvalidFileError("GIF decode exceeded time limit");
    }
    const marker = bytes[offset]!;
    if (marker === 0x3b) {
      break;
    }
    if (marker === 0x21) {
      offset = skipSubBlocks(bytes, offset + 2);
      continue;
    }
    if (marker !== 0x2c) {
      throw new StreamGifInvalidFileError("GIF contains an unknown block");
    }
    if (offset + 10 > bytes.length) {
      throw new StreamGifInvalidFileError("truncated GIF frame");
    }
    const frameWidth = readU16(bytes, offset + 4);
    const frameHeight = readU16(bytes, offset + 6);
    if (
      frameWidth < 1 ||
      frameHeight < 1 ||
      frameWidth > STREAM_GIF_MAX_WIDTH ||
      frameHeight > STREAM_GIF_MAX_HEIGHT
    ) {
      throw new StreamGifInvalidFileError("GIF frame resolution is too large");
    }
    const framePixels = frameWidth * frameHeight;
    if (framePixels > maxPixelsPerFrame) {
      throw new StreamGifInvalidFileError("GIF frame expanded past pixel limit");
    }
    const localPacked = bytes[offset + 9]!;
    offset += 10;
    if ((localPacked & 0x80) !== 0) {
      const lctSize = 3 * (1 << ((localPacked & 7) + 1));
      offset += lctSize;
    }
    const image = collectImageData(bytes, offset);
    decodeLzw(bytes[offset]!, image.data, {
      startedMs,
      now,
      lzwMaxMs,
      maxPerFrame: Math.min(framePixels, maxPixelsPerFrame),
      totalDecoded,
      maxDecodedPixels,
    });
    offset = image.next;
    frames += 1;
    if (frames > STREAM_GIF_MAX_FRAMES) {
      throw new StreamGifInvalidFileError("GIF has too many frames");
    }
  }
  if (frames < 1) {
    throw new StreamGifInvalidFileError("GIF has no frames");
  }
  return { width, height, frameCount: frames };
}

/** 1×1 GIF89a used in isolated tests. */
export function minimalTestGif(): Buffer {
  return Buffer.from(
    "47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b",
    "hex",
  );
}
