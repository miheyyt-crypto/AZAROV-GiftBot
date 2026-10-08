import { inflateSync } from "node:zlib";
import {
  StreamMediaCodecUnsupportedError,
  StreamMediaCorruptError,
  StreamMediaLimitError,
  StreamMediaTooLargeError,
  StreamMediaUnsupportedFormatError,
} from "./errors.js";
import {
  inspectGif,
  STREAM_GIF_DISPLAY_MAX,
  STREAM_GIF_MAX_BYTES,
  STREAM_GIF_SOURCE_MAX,
} from "./gif-inspect.js";

export const STREAM_MEDIA_MAX_BYTES = STREAM_GIF_MAX_BYTES;
export const STREAM_MEDIA_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export type StreamMediaKind = "image" | "gif" | "video";

export type InspectedStreamMedia = {
  kind: StreamMediaKind;
  contentType: string;
  extension: "jpg" | "png" | "webp" | "gif" | "mp4" | "mov" | "webm";
  width: number;
  height: number;
  frameCount: number;
  durationMs: number;
  obsNative: boolean;
  needsPrepare: boolean;
  codec?: string;
  loopCount?: number | null;
};

export type PreparedStreamMedia = InspectedStreamMedia & {
  bytes: Buffer;
};

export type StreamMediaTranscoder = {
  transcodeToObsMp4(bytes: Buffer): Promise<Buffer>;
};

const OBS_VIDEO_CODECS = new Set(["avc1", "avc3", "vp08", "vp8", "vp09", "vp9", "av01"]);

function sniff(bytes: Buffer): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes.subarray(1, 4).toString("ascii") === "PNG"
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") {
      return "gif";
    }
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (brand === "qt  " || brand.startsWith("qt")) {
      return "mov";
    }
    return "mp4";
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "webm";
  }
  return undefined;
}

function assertDims(width: number, height: number): { needsDownscale: boolean } {
  if (width < 1 || height < 1) {
    throw new StreamMediaCorruptError();
  }
  if (width > STREAM_GIF_SOURCE_MAX || height > STREAM_GIF_SOURCE_MAX) {
    throw new StreamMediaLimitError("Разрешение больше 8192×8192");
  }
  return {
    needsDownscale:
      width > STREAM_GIF_DISPLAY_MAX || height > STREAM_GIF_DISPLAY_MAX,
  };
}

function inspectJpeg(bytes: Buffer): InspectedStreamMedia {
  let i = 2;
  let width = 0;
  let height = 0;
  let sos = false;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      throw new StreamMediaCorruptError();
    }
    while (i < bytes.length && bytes[i] === 0xff) {
      i += 1;
    }
    if (i >= bytes.length) {
      break;
    }
    const marker = bytes[i]!;
    i += 1;
    if (marker === 0xd9) {
      break;
    }
    if (marker === 0xda) {
      sos = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (i + 2 > bytes.length) {
      throw new StreamMediaCorruptError();
    }
    const len = bytes.readUInt16BE(i);
    if (len < 2 || i + len > bytes.length) {
      throw new StreamMediaCorruptError();
    }
    if (marker >= 0xc0 && marker <= 0xc3) {
      if (len < 7) {
        throw new StreamMediaCorruptError();
      }
      height = bytes.readUInt16BE(i + 3);
      width = bytes.readUInt16BE(i + 5);
    }
    i += len;
  }
  if (!sos || width < 1 || height < 1) {
    throw new StreamMediaCorruptError();
  }
  const dims = assertDims(width, height);
  return {
    kind: "image",
    contentType: "image/jpeg",
    extension: "jpg",
    width,
    height,
    frameCount: 1,
    durationMs: 0,
    obsNative: !dims.needsDownscale,
    needsPrepare: dims.needsDownscale,
  };
}

function inspectPng(bytes: Buffer): InspectedStreamMedia {
  if (bytes.length < 33) {
    throw new StreamMediaCorruptError();
  }
  const ihdrLen = bytes.readUInt32BE(8);
  if (ihdrLen !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new StreamMediaCorruptError();
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const dims = assertDims(width, height);
  let offset = 8;
  const idats: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length || len < 0) {
      throw new StreamMediaCorruptError();
    }
    if (type === "IDAT") {
      idats.push(bytes.subarray(dataStart, dataEnd));
    }
    if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (idats.length === 0) {
    throw new StreamMediaCorruptError();
  }
  try {
    inflateSync(Buffer.concat(idats));
  } catch {
    throw new StreamMediaCorruptError();
  }
  return {
    kind: "image",
    contentType: "image/png",
    extension: "png",
    width,
    height,
    frameCount: 1,
    durationMs: 0,
    obsNative: !dims.needsDownscale,
    needsPrepare: dims.needsDownscale,
  };
}

function inspectWebp(bytes: Buffer): InspectedStreamMedia {
  if (bytes.length < 20) {
    throw new StreamMediaCorruptError();
  }
  const chunk = bytes.subarray(12, 16).toString("ascii");
  let width = 0;
  let height = 0;
  if (chunk === "VP8X" && bytes.length >= 30) {
    width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
  } else if (chunk === "VP8 " && bytes.length >= 30) {
    width = bytes.readUInt16LE(26) & 0x3fff;
    height = bytes.readUInt16LE(28) & 0x3fff;
  } else if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >> 14) & 0x3fff) + 1;
  } else {
    throw new StreamMediaCorruptError();
  }
  const dims = assertDims(width, height);
  const animated = chunk === "VP8X" && bytes.length >= 21 && (bytes[20]! & 0x02) !== 0;
  return {
    kind: "image",
    contentType: "image/webp",
    extension: "webp",
    width,
    height,
    frameCount: animated ? 2 : 1,
    durationMs: 0,
    obsNative: !dims.needsDownscale,
    needsPrepare: dims.needsDownscale,
  };
}

function readBoxes(
  bytes: Buffer,
  start: number,
  end: number,
  visit: (type: string, payloadStart: number, payloadEnd: number) => void,
): void {
  let offset = start;
  while (offset + 8 <= end) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) {
        throw new StreamMediaCorruptError();
      }
      const big = bytes.readUInt32BE(offset + 8);
      const low = bytes.readUInt32BE(offset + 12);
      if (big !== 0) {
        throw new StreamMediaLimitError("Видео слишком тяжёлое для обработки");
      }
      size = low;
      header = 16;
    }
    if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) {
      throw new StreamMediaCorruptError();
    }
    visit(type, offset + header, offset + size);
    offset += size;
  }
}

function inspectIsoBmff(bytes: Buffer, container: "mp4" | "mov"): InspectedStreamMedia {
  let codec = "";
  let width = 0;
  let height = 0;
  const walk = (start: number, end: number): void => {
    readBoxes(bytes, start, end, (type, payloadStart, payloadEnd) => {
      if (type === "moov" || type === "trak" || type === "mdia" || type === "minf" || type === "stbl") {
        walk(payloadStart, payloadEnd);
        return;
      }
      if (type === "stsd") {
        if (payloadEnd - payloadStart < 8) {
          throw new StreamMediaCorruptError();
        }
        readBoxes(bytes, payloadStart + 8, payloadEnd, (format, sampleStart, sampleEnd) => {
          if (!codec) {
            codec = format.trim();
          }
          if (sampleEnd - sampleStart >= 28 && width === 0) {
            width = bytes.readUInt16BE(sampleStart + 24);
            height = bytes.readUInt16BE(sampleStart + 26);
          }
        });
      }
    });
  };
  walk(0, bytes.length);
  if (!codec) {
    for (const marker of ["avc1", "avc3", "hvc1", "hev1", "vp09", "av01", "mp4v"] as const) {
      if (bytes.includes(Buffer.from(marker))) {
        codec = marker;
        break;
      }
    }
  }
  if (!codec) {
    throw new StreamMediaCorruptError();
  }
  if (width > 0 && height > 0) {
    assertDims(width, height);
  }
  const obsNative = OBS_VIDEO_CODECS.has(codec.toLowerCase()) && container === "mp4";
  return {
    kind: "video",
    contentType: container === "mov" ? "video/quicktime" : "video/mp4",
    extension: container,
    width: width || 1,
    height: height || 1,
    frameCount: 1,
    durationMs: 0,
    obsNative,
    needsPrepare: true,
    codec,
  };
}

function inspectWebm(bytes: Buffer): InspectedStreamMedia {
  const text = bytes.subarray(0, Math.min(bytes.length, 4096)).toString("latin1");
  let codec = "";
  if (text.includes("V_MPEGH/ISO/HEVC") || text.includes("V_HEVC")) {
    codec = "hevc";
  } else if (text.includes("V_MPEG4/ISO/AVC")) {
    codec = "avc1";
  } else if (text.includes("V_VP9")) {
    codec = "vp9";
  } else if (text.includes("V_VP8")) {
    codec = "vp8";
  } else if (text.includes("V_AV1")) {
    codec = "av01";
  }
  if (!codec) {
    throw new StreamMediaCorruptError();
  }
  return {
    kind: "video",
    contentType: "video/webm",
    extension: "webm",
    width: 1,
    height: 1,
    frameCount: 1,
    durationMs: 0,
    obsNative: OBS_VIDEO_CODECS.has(codec),
    needsPrepare: true,
    codec,
  };
}

export function inspectStreamMedia(bytes: Buffer): InspectedStreamMedia {
  if (bytes.byteLength <= 0) {
    throw new StreamMediaUnsupportedFormatError();
  }
  if (bytes.byteLength > STREAM_MEDIA_MAX_BYTES) {
    throw new StreamMediaTooLargeError();
  }
  const kind = sniff(bytes);
  if (!kind) {
    throw new StreamMediaUnsupportedFormatError();
  }
  if (kind === "gif") {
    const gif = inspectGif(bytes);
    const finiteLoop = gif.frameCount > 1 && gif.loopCount === 1;
    const needsPrepare = gif.needsDownscale || finiteLoop;
    return {
      kind: "gif",
      contentType: "image/gif",
      extension: "gif",
      width: gif.width,
      height: gif.height,
      frameCount: gif.frameCount,
      durationMs: 0,
      obsNative: !needsPrepare,
      needsPrepare,
      loopCount: gif.loopCount,
    };
  }
  if (kind === "jpeg") {
    return inspectJpeg(bytes);
  }
  if (kind === "png") {
    return inspectPng(bytes);
  }
  if (kind === "webp") {
    return inspectWebp(bytes);
  }
  if (kind === "mp4" || kind === "mov") {
    return inspectIsoBmff(bytes, kind);
  }
  return inspectWebm(bytes);
}

export async function prepareStreamMedia(
  bytes: Buffer,
  options: { transcoder?: StreamMediaTranscoder } = {},
): Promise<PreparedStreamMedia> {
  const inspected = inspectStreamMedia(bytes);
  if (!inspected.needsPrepare) {
    return { ...inspected, bytes };
  }
  const codec = inspected.codec ?? inspected.contentType;
  if (!options.transcoder) {
    throw new StreamMediaCodecUnsupportedError(
      `Этот кодек OBS не воспроизведёт (${codec}). Нужен H.264, VP8, VP9 или AV1, либо конвертация через ffmpeg.`,
    );
  }
  let converted: Buffer;
  try {
    converted = await options.transcoder.transcodeToObsMp4(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "convert failed";
    throw new StreamMediaCodecUnsupportedError(
      `Этот кодек OBS не воспроизведёт (${codec}): ${detail}`,
    );
  }
  if (converted.byteLength <= 0 || converted.byteLength > STREAM_MEDIA_MAX_BYTES) {
    throw new StreamMediaLimitError("После конвертации файл больше 10 МБ");
  }
  const again = inspectStreamMedia(converted);
  if (again.kind !== "video" || !again.obsNative) {
    throw new StreamMediaCodecUnsupportedError(
      `Этот кодек OBS не воспроизведёт (${codec}). Конвертация не дала H.264 MP4.`,
    );
  }
  return { ...again, bytes: converted, contentType: "video/mp4", extension: "mp4" };
}

/** 1×1 PNG used in isolated tests. */
export function minimalTestPng(): Buffer {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex",
  );
}

/** SOF0 + SOS JPEG so decode checks dimensions without a Huffman scan. */
export function minimalTestJpeg(): Buffer {
  return Buffer.from(
    "ffd8ffc0000b080001000101011100ffda0008010100003f0000ffd9",
    "hex",
  );
}
