import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { StreamDonationInvalidRequestError } from "./errors.js";

const DONATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function donationIdOf(raw: string): string {
  const value = raw.trim();
  if (!DONATION_ID_RE.test(value)) {
    throw new StreamDonationInvalidRequestError();
  }
  return value;
}

export const STREAM_ALERT_TTS_SUBDIR = "stream-alerts-tts";
export const STREAM_ALERT_TTS_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const STREAM_ALERT_DING_GAP_MS = 400;
/** Ceiling of applepay.mp3 duration (~1.41s); lease must cover the full ding. */
export const STREAM_ALERT_DING_MS = 1_500;
/** Overlay poll + preload before the card is shown. Cold load may delay the card, not silence after it. */
export const STREAM_ALERT_TTS_WAIT_MS = 20_000;
export const STREAM_ALERT_TTS_PLAY_MAX_MS = 90_000;
export const STREAM_ALERT_COMPLETE_TIMEOUT_MS = 120_000;
export const STREAM_ALERT_HEARTBEAT_EXTEND_MS = 45_000;
export const STREAM_ALERT_PLAYING_MAX_MS = 180_000;
/** Warm 300-char Silero is ~2–4s; 60s covers cold load + stress + synth. */
export const STREAM_ALERT_TTS_JOB_TIMEOUT_MS = 60_000;
export const DEFAULT_STREAM_ALERT_TTS_VOICE = "ru_roman";

export type StreamDonationTtsStatus =
  | "pending"
  | "ready"
  | "failed"
  | "skipped";

export function resolveStreamAlertsTtsDir(input: {
  ttsDir?: string;
  uploadDir?: string;
}): string | undefined {
  if (input.ttsDir && input.ttsDir.trim().length > 0) {
    return input.ttsDir.trim();
  }
  if (input.uploadDir && input.uploadDir.trim().length > 0) {
    return join(input.uploadDir.trim(), STREAM_ALERT_TTS_SUBDIR);
  }
  return undefined;
}

export function streamDonationTtsVoiceId(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,64}$/.test(value)) {
    throw new StreamDonationInvalidRequestError();
  }
  return value;
}

export function streamDonationAudioFileName(
  donationId: string,
  voice?: string,
): string {
  const id = donationIdOf(donationId);
  if (!voice) {
    return `${id}.wav`;
  }
  return `${id}.${streamDonationTtsVoiceId(voice)}.wav`;
}

export function streamDonationAudioPath(
  ttsDir: string,
  donationId: string,
  voice?: string,
): string {
  const root = resolve(ttsDir);
  const file = join(root, streamDonationAudioFileName(donationId, voice));
  const relative = file.slice(root.length);
  if (!relative.startsWith(sep) || relative.includes("..")) {
    throw new Error("tts path escaped storage dir");
  }
  if (basename(file) !== streamDonationAudioFileName(donationId, voice)) {
    throw new Error("tts path escaped storage dir");
  }
  return file;
}

export function encodePcmWav(samples: Int16Array, sampleRate: number): Buffer {
  const dataBytes = samples.byteLength;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  Buffer.from(samples.buffer, samples.byteOffset, dataBytes).copy(buffer, 44);
  return buffer;
}

export function encodeDonationDingWav(): Buffer {
  const sampleRate = 22_050;
  const seconds = 0.32;
  const samples = new Int16Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 8);
    const tone = Math.sin(2 * Math.PI * 880 * t) + 0.45 * Math.sin(2 * Math.PI * 1320 * t);
    samples[i] = Math.max(-32767, Math.min(32767, Math.round(tone * env * 12000)));
  }
  return encodePcmWav(samples, sampleRate);
}

export function wavDurationMs(bytes: Buffer): number {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF") {
    return 0;
  }
  const byteRate = bytes.readUInt32LE(28);
  if (byteRate <= 0) {
    return 0;
  }
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === "data") {
      dataBytes = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataBytes <= 0) {
    dataBytes = Math.max(0, bytes.length - 44);
  }
  return Math.max(1, Math.round((dataBytes / byteRate) * 1000));
}

export function streamDonationPlayingHoldMs(input: {
  ttsStatus: StreamDonationTtsStatus;
  ttsDurationMs: number | null;
}): number {
  const dingAndGap = STREAM_ALERT_DING_MS + STREAM_ALERT_DING_GAP_MS;
  const fade = 900;
  const buffer = 20_000;
  const preshowWait = STREAM_ALERT_TTS_WAIT_MS;
  if (input.ttsStatus === "ready" && (input.ttsDurationMs ?? 0) > 0) {
    return Math.min(
      preshowWait + dingAndGap + (input.ttsDurationMs ?? 0) + fade + buffer,
      STREAM_ALERT_PLAYING_MAX_MS,
    );
  }
  if (input.ttsStatus === "pending") {
    return Math.min(
      preshowWait +
        dingAndGap +
        STREAM_ALERT_TTS_PLAY_MAX_MS +
        fade +
        buffer,
      STREAM_ALERT_PLAYING_MAX_MS,
    );
  }
  return 45_000;
}

export async function ensureStreamAlertsTtsDir(ttsDir: string): Promise<void> {
  await mkdir(ttsDir, { recursive: true });
}

export async function cleanupOldStreamAlertTtsFiles(
  ttsDir: string,
  maxAgeMs = STREAM_ALERT_TTS_MAX_AGE_MS,
  nowMs = Date.now(),
): Promise<number> {
  let removed = 0;
  let names: string[] = [];
  try {
    names = await readdir(ttsDir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.endsWith(".wav")) {
      continue;
    }
    const file = join(ttsDir, name);
    try {
      const info = await stat(file);
      if (nowMs - info.mtimeMs >= maxAgeMs) {
        await unlink(file);
        removed += 1;
      }
    } catch {
      // Ignore files removed concurrently.
    }
  }
  return removed;
}
