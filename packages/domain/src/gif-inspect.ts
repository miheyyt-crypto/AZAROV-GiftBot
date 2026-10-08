import {
  StreamMediaCorruptError,
  StreamMediaLimitError,
  StreamMediaTooLargeError,
  StreamMediaUnsupportedFormatError,
} from "./errors.js";

export const STREAM_GIF_MAX_BYTES = 10 * 1024 * 1024;
/** 10 MiB file + multipart/binary headers. */
export const STREAM_GIF_UPLOAD_BODY_MAX = 12 * 1024 * 1024;
export const STREAM_GIF_DISPLAY_MAX = 1920;
export const STREAM_GIF_SOURCE_MAX = 8192;
export const STREAM_GIF_MAX_WIDTH = STREAM_GIF_SOURCE_MAX;
export const STREAM_GIF_MAX_HEIGHT = STREAM_GIF_SOURCE_MAX;
export const STREAM_GIF_MAX_FRAMES = 240;
export const STREAM_GIF_MAX_PIXELS_PER_FRAME =
  STREAM_GIF_DISPLAY_MAX * STREAM_GIF_DISPLAY_MAX;
/** Caps expanded LZW output across all frames (VPS CPU/RAM). */
export const STREAM_GIF_MAX_DECODED_PIXELS = 16_777_216;
export const STREAM_GIF_LZW_MAX_MS = 400;
export const STREAM_GIF_STAGING_TTL_MS = 60 * 60 * 1000;
export const STREAM_GIF_VISIBLE_MS = 7_000;
export const STREAM_GIF_PRELOAD_MS = 8_000;
export const STREAM_GIF_MESSAGE = "Медиа";
export const STREAM_GIF_SHOP_PRODUCT_CODE = "gif-stream";

export type InspectedGif = {
  width: number;
  height: number;
  frameCount: number;
  /** 0 = infinite, 1 = play once, null = unspecified (treat as infinite). */
  loopCount: number | null;
  needsDownscale: boolean;
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
  throw new StreamMediaCorruptError("Не удалось прочитать файл");
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
    throw new StreamMediaCorruptError("Не удалось прочитать файл");
  }
  if (data.length === 0) {
    throw new StreamMediaCorruptError("Не удалось прочитать файл");
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
      throw new StreamMediaCorruptError("Не удалось прочитать файл");
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
      throw new StreamMediaLimitError("Обработка GIF превысила лимит времени");
    }
    const code = readCode();
    if (code === eoi) {
      if (decoded === 0) {
        throw new StreamMediaCorruptError("Не удалось прочитать файл");
      }
      limits.totalDecoded.value += decoded;
      if (limits.totalDecoded.value > limits.maxDecodedPixels) {
        throw new StreamMediaLimitError("GIF слишком тяжёлый для обработки");
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
      throw new StreamMediaCorruptError("Не удалось прочитать файл");
    }
    decoded += entryLen;
    if (decoded > limits.maxPerFrame) {
      throw new StreamMediaLimitError("GIF слишком тяжёлый для обработки");
    }
    if (prevLen > 0 && nextCode < 4096) {
      const nextLen = prevLen + 1;
      if (nextLen > 0xffff) {
        throw new StreamMediaCorruptError("Не удалось прочитать файл");
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
    throw new StreamMediaCorruptError("Не удалось прочитать файл");
  }
  limits.totalDecoded.value += decoded;
  if (limits.totalDecoded.value > limits.maxDecodedPixels) {
    throw new StreamMediaLimitError("GIF слишком тяжёлый для обработки");
  }
  return decoded;
}

function collectImageData(bytes: Buffer, offset: number): { data: Buffer; next: number } {
  const minCodeSize = bytes[offset];
  if (minCodeSize === undefined) {
    throw new StreamMediaCorruptError("Не удалось прочитать файл");
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
      throw new StreamMediaCorruptError("Не удалось прочитать файл");
    }
    chunks.push(bytes.subarray(i, i + size));
    i += size;
  }
  throw new StreamMediaCorruptError("Не удалось прочитать файл");
}

export function inspectGif(bytes: Buffer, limits: InspectGifLimits = {}): InspectedGif {
  const now = limits.now ?? Date.now;
  const startedMs = now();
  const lzwMaxMs = limits.lzwMaxMs ?? STREAM_GIF_LZW_MAX_MS;
  const maxDecodedPixels = limits.maxDecodedPixels ?? STREAM_GIF_MAX_DECODED_PIXELS;
  const maxPixelsPerFrame = limits.maxPixelsPerFrame ?? STREAM_GIF_MAX_PIXELS_PER_FRAME;
  if (bytes.byteLength <= 0 || bytes.byteLength > STREAM_GIF_MAX_BYTES) {
    throw new StreamMediaTooLargeError();
  }
  const header = bytes.length >= 6 ? bytes.subarray(0, 6).toString("ascii") : "";
  if (header !== "GIF87a" && header !== "GIF89a") {
    throw new StreamMediaUnsupportedFormatError();
  }
  if (bytes.length < 13) {
    throw new StreamMediaCorruptError("Не удалось прочитать файл");
  }
  const width = readU16(bytes, 6);
  const height = readU16(bytes, 8);
  if (width < 1 || height < 1) {
    throw new StreamMediaCorruptError("Не удалось прочитать файл");
  }
  if (width > STREAM_GIF_SOURCE_MAX || height > STREAM_GIF_SOURCE_MAX) {
    throw new StreamMediaLimitError("Разрешение больше 8192×8192");
  }
  const needsDownscale =
    width > STREAM_GIF_DISPLAY_MAX || height > STREAM_GIF_DISPLAY_MAX;
  let loopCount: number | null = null;
  if (needsDownscale) {
    return {
      width,
      height,
      frameCount: 1,
      loopCount,
      needsDownscale: true,
    };
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
      throw new StreamMediaLimitError("Обработка GIF превысила лимит времени");
    }
    const marker = bytes[offset]!;
    if (marker === 0x3b) {
      break;
    }
    if (marker === 0x21) {
      const label = bytes[offset + 1];
      if (label === 0xff && bytes.length >= offset + 16) {
        const app = bytes.subarray(offset + 3, offset + 14).toString("ascii");
        if (app === "NETSCAPE2.0" && bytes[offset + 14] === 0x03 && bytes[offset + 15] === 0x01) {
          loopCount = readU16(bytes, offset + 16);
        }
      }
      offset = skipSubBlocks(bytes, offset + 2);
      continue;
    }
    if (marker !== 0x2c) {
      throw new StreamMediaCorruptError("Не удалось прочитать файл");
    }
    if (offset + 10 > bytes.length) {
      throw new StreamMediaCorruptError("Не удалось прочитать файл");
    }
    const frameWidth = readU16(bytes, offset + 4);
    const frameHeight = readU16(bytes, offset + 6);
    if (
      frameWidth < 1 ||
      frameHeight < 1 ||
      frameWidth > STREAM_GIF_DISPLAY_MAX ||
      frameHeight > STREAM_GIF_DISPLAY_MAX
    ) {
      throw new StreamMediaLimitError("Разрешение больше 1920×1920");
    }
    const framePixels = frameWidth * frameHeight;
    if (framePixels > maxPixelsPerFrame) {
      throw new StreamMediaLimitError("GIF слишком тяжёлый для обработки");
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
      throw new StreamMediaLimitError("GIF слишком тяжёлый для обработки");
    }
  }
  if (frames < 1) {
    throw new StreamMediaCorruptError("Не удалось прочитать файл");
  }
  return { width, height, frameCount: frames, loopCount, needsDownscale: false };
}

/** 1×1 GIF89a used in isolated tests. */
export function minimalTestGif(): Buffer {
  return Buffer.from(
    "47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b",
    "hex",
  );
}
