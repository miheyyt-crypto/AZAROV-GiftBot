import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StreamMediaCodecUnsupportedError } from "./errors.js";
import {
  inspectStreamMedia,
  type InspectedStreamMedia,
  type PreparedStreamMedia,
  type StreamMediaTranscoder,
} from "./media-inspect.js";

export const STREAM_MEDIA_FFMPEG_TIMEOUT_MS = 25_000;
const DISPLAY_MAX = 1920;
const OBS_CODECS = new Set(["h264", "avc1", "avc3", "vp8", "vp9", "av1", "av01"]);

export function createFfmpegObsTranscoder(
  ffmpegBin = process.env.FFMPEG_BIN ?? "ffmpeg",
): StreamMediaTranscoder {
  return {
    async transcodeToObsMp4(bytes) {
      const prepared = await prepareObsPlayback({
        bytes,
        ffmpegBin,
        ffprobeBin: process.env.FFPROBE_BIN ?? "ffprobe",
        inspected: inspectStreamMedia(bytes),
      });
      return prepared.bytes;
    },
  };
}

export async function prepareObsPlayback(input: {
  bytes: Buffer;
  inspected: InspectedStreamMedia;
  ffmpegBin?: string;
  ffprobeBin?: string;
}): Promise<PreparedStreamMedia> {
  const ffmpegBin = input.ffmpegBin ?? process.env.FFMPEG_BIN ?? "ffmpeg";
  const ffprobeBin = input.ffprobeBin ?? process.env.FFPROBE_BIN ?? "ffprobe";
  const dir = await mkdtemp(join(tmpdir(), "giftbot-obs-"));
  const src = join(dir, `in.${input.inspected.extension}`);
  await writeFile(src, input.bytes);
  try {
    if (input.inspected.kind === "video" || input.inspected.extension === "mov") {
      const probe = await runFfprobe(ffprobeBin, src);
      const codec = (probe.codec ?? input.inspected.codec ?? "").toLowerCase();
      const containerOk =
        input.inspected.extension === "mp4" || input.inspected.extension === "webm";
      const codecOk = OBS_CODECS.has(codec);
      if (containerOk && codecOk && !needsScale(probe.width, probe.height)) {
        return {
          ...input.inspected,
          bytes: input.bytes,
          width: probe.width || input.inspected.width,
          height: probe.height || input.inspected.height,
          durationMs: probe.durationMs,
          obsNative: true,
          needsPrepare: false,
          codec,
        };
      }
      const out = join(dir, "out.mp4");
      await runFfmpeg(
        ffmpegBin,
        obsVideoEncodeArgs({ src, out, hasAudio: probe.hasAudio }),
      );
      const converted = await readFile(out);
      const again = inspectStreamMedia(converted);
      const probed = await runFfprobe(ffprobeBin, out);
      if (!OBS_CODECS.has((probed.codec ?? "").toLowerCase())) {
        throw new StreamMediaCodecUnsupportedError(
          `После конвертации кодек ${probed.codec ?? "unknown"} всё ещё не для OBS`,
        );
      }
      return {
        ...again,
        bytes: converted,
        contentType: "video/mp4",
        extension: "mp4",
        durationMs: probed.durationMs,
        obsNative: true,
        needsPrepare: false,
        codec: probed.codec,
      };
    }
    if (input.inspected.kind === "gif") {
      const out = join(dir, "out.gif");
      await runFfmpeg(ffmpegBin, [
        "-y",
        "-i",
        src,
        "-an",
        "-filter_complex",
        `${scaleFilter()},split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=alpha_threshold=128`,
        "-loop",
        "0",
        "-threads",
        "1",
        out,
      ]);
      const converted = await readFile(out);
      const again = inspectStreamMedia(converted);
      return {
        ...again,
        bytes: converted,
        needsPrepare: false,
        obsNative: true,
        loopCount: 0,
      };
    }
    if (input.inspected.extension === "webp" && input.inspected.frameCount > 1) {
      const out = join(dir, "out.webp");
      await runFfmpeg(ffmpegBin, [
        "-y",
        "-i",
        src,
        "-an",
        "-loop",
        "0",
        "-vf",
        scaleFilter(),
        "-c:v",
        "libwebp",
        "-threads",
        "1",
        out,
      ]);
      const converted = await readFile(out);
      const again = inspectStreamMedia(converted);
      return { ...again, bytes: converted, needsPrepare: false, obsNative: true };
    }
    const outExt = input.inspected.extension === "jpg" ? "jpg" : input.inspected.extension;
    const out = join(dir, `out.${outExt}`);
    const codec =
      outExt === "png" ? "png" : outExt === "webp" ? "libwebp" : "mjpeg";
    await runFfmpeg(ffmpegBin, [
      "-y",
      "-i",
      src,
      "-frames:v",
      "1",
      "-c:v",
      codec,
      "-threads",
      "1",
      "-vf",
      scaleFilter(),
      out,
    ]);
    const converted = await readFile(out);
    const again = inspectStreamMedia(converted);
    return { ...again, bytes: converted, needsPrepare: false, obsNative: true };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function needsScale(width: number, height: number): boolean {
  return width > DISPLAY_MAX || height > DISPLAY_MAX;
}

function scaleFilter(): string {
  return `scale='min(${DISPLAY_MAX},iw)':'min(${DISPLAY_MAX},ih)':force_original_aspect_ratio=decrease`;
}

/** Video keep/convert audio. GIF/WebP still use `-an`. */
export function obsVideoEncodeArgs(input: {
  src: string;
  out: string;
  hasAudio: boolean;
}): string[] {
  const args = [
    "-y",
    "-i",
    input.src,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-vf",
    scaleFilter(),
  ];
  if (input.hasAudio) {
    args.push("-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "44100");
  }
  args.push(input.out);
  return args;
}

export function ffmpegArgsDropAudio(args: readonly string[]): boolean {
  return args.includes("-an");
}

type Probe = {
  codec: string;
  width: number;
  height: number;
  durationMs: number;
  hasAudio: boolean;
};

async function runFfprobe(bin: string, file: string): Promise<Probe> {
  const raw = await spawnCapture(bin, [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,duration:format=duration",
    "-of",
    "json",
    file,
  ]);
  const parsed = JSON.parse(raw) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
    }>;
    format?: { duration?: string };
  };
  const streams = parsed.streams ?? [];
  const video =
    streams.find((row) => row.codec_type === "video") ?? streams[0];
  const hasAudio = streams.some((row) => row.codec_type === "audio");
  const durationRaw = video?.duration ?? parsed.format?.duration ?? "0";
  const durationMs = Math.max(0, Math.round(Number(durationRaw) * 1000));
  if (!Number.isFinite(durationMs)) {
    throw new StreamMediaCodecUnsupportedError("ffprobe не вернул длительность");
  }
  return {
    codec: video?.codec_name ?? "",
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    durationMs,
    hasAudio,
  };
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return spawnCapture(bin, args).then(() => undefined);
}

function spawnCapture(bin: string, args: string[]): Promise<string> {
  if (process.platform !== "win32" && !bin.endsWith("ffprobe") && bin !== "ffprobe") {
    return spawnOnce("nice", ["-n", "15", bin, ...args]).catch((error) => {
      if ((error as { code?: string }).code === "ENOENT") {
        return spawnOnce(bin, args);
      }
      throw error;
    });
  }
  return spawnOnce(bin, args);
}

function spawnOnce(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        OMP_NUM_THREADS: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk.slice(-2000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new StreamMediaCodecUnsupportedError("конвертация превысила 25 с"));
    }, STREAM_MEDIA_FFMPEG_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new StreamMediaCodecUnsupportedError(
          `ffmpeg/ffprobe недоступен (${error.message})`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new StreamMediaCodecUnsupportedError(
          `ffmpeg завершился с кодом ${code}${stderr ? `: ${stderr.trim().slice(-300)}` : ""}`,
        ),
      );
    });
  });
}
