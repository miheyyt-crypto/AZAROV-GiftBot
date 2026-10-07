/**
 * Local/VPS Piper sample + resource bench. Does not call GiftBot APIs or debit AZC.
 *
 * Voices: dmitri + denis (dataset CC0). ruslan CC BY-NC-SA and irina Unknown are skipped.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = process.env.TTS_BENCH_DIR
  ? path.resolve(process.env.TTS_BENCH_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORK = path.join(ROOT, ".local-piper");
const SAMPLES = path.join(ROOT, ".tts-samples");
const HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const VOICES = [
  {
    id: "dmitri",
    license: "CC0",
    model: "ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx",
  },
  {
    id: "denis",
    license: "CC0",
    model: "ru/ru_RU/denis/medium/ru_RU-denis-medium.onnx",
  },
];
const TEXTS = [
  { id: "short", text: "Спасибо за донат, брат." },
  { id: "medium", text: "Залетай на стрим, сегодня крутим кейсы и раздаём плюшки." },
  {
    id: "long",
    text: "Привет Азаров, держи тысячу. Поставь трек погромче и скажи всем в чате, что донат дошёл без наложения голосов.",
  },
];

function piperArchive() {
  if (process.platform === "win32") {
    return {
      url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
      bin: path.join(WORK, "piper", "piper.exe"),
    };
  }
  return {
    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz",
    bin: path.join(WORK, "piper", "piper"),
  };
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${res.status} ${url}`);
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function extractArchive(archive) {
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const child = spawn(
        "tar",
        ["-xf", archive, "-C", WORK],
        { stdio: "inherit", windowsHide: true },
      );
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`tar ${code}`)),
      );
    });
    return;
  }
  await new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", WORK], {
      stdio: "inherit",
    });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`tar ${code}`)),
    );
  });
}

async function childPeakRssKb(pid) {
  if (process.platform !== "linux" || !pid) {
    return 0;
  }
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const match = status.match(/^VmHWM:\s+(\d+) kB/m);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function runPiper(bin, model, text, outputFile) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(bin, ["--model", model, "--output_file", outputFile], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, OMP_NUM_THREADS: "1" },
    });
    let peakRssKb = 0;
    const probe = setInterval(() => {
      void childPeakRssKb(child.pid).then((kb) => {
        if (kb > peakRssKb) {
          peakRssKb = kb;
        }
      });
    }, 40);
    child.stdin.write(text, "utf8");
    child.stdin.end();
    child.on("close", (code) => {
      clearInterval(probe);
      if (code === 0) {
        resolve({ ms: Date.now() - started, peakRssKb });
        return;
      }
      reject(new Error(`piper ${code}`));
    });
    child.on("error", (error) => {
      clearInterval(probe);
      reject(error);
    });
  });
}

function wavDurationMs(bytes) {
  if (bytes.length < 44) {
    return 0;
  }
  const byteRate = bytes.readUInt32LE(28);
  return byteRate > 0 ? Math.round(((bytes.length - 44) / byteRate) * 1000) : 0;
}

const archive = piperArchive();
await mkdir(WORK, { recursive: true });
await mkdir(SAMPLES, { recursive: true });
if (!(await exists(archive.bin))) {
  const zipPath = path.join(
    WORK,
    process.platform === "win32" ? "piper.zip" : "piper.tar.gz",
  );
  if (!(await exists(zipPath))) {
    process.stdout.write(`downloading piper\n`);
    await download(archive.url, zipPath);
  }
  await extractArchive(zipPath);
}

const rows = [];
for (const voice of VOICES) {
  const modelPath = path.join(WORK, "voices", path.basename(voice.model));
  const jsonPath = `${modelPath}.json`;
  if (!(await exists(modelPath))) {
    process.stdout.write(`downloading ${voice.id} model (${voice.license})\n`);
    await download(`${HF}/${voice.model}`, modelPath);
    await download(`${HF}/${voice.model}.json`, jsonPath);
  }
  for (const sample of TEXTS) {
    const out = path.join(SAMPLES, `${voice.id}-${sample.id}.wav`);
    const startedRss = process.memoryUsage().rss;
    const cpuStart = process.cpuUsage();
    const result = await runPiper(archive.bin, modelPath, sample.text, out);
    const cpu = process.cpuUsage(cpuStart);
    const bytes = await readFile(out);
    const row = {
      voice: voice.id,
      license: voice.license,
      sample: sample.id,
      chars: sample.text.length,
      genMs: result.ms,
      peakRssMb: result.peakRssKb
        ? Number((result.peakRssKb / 1024).toFixed(1))
        : null,
      durationMs: wavDurationMs(bytes),
      bytes: bytes.length,
      rssDeltaMb: Number(
        ((process.memoryUsage().rss - startedRss) / 1024 / 1024).toFixed(2),
      ),
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
    };
    rows.push(row);
    process.stdout.write(`${JSON.stringify(row)}\n`);
  }
}

await writeFile(
  path.join(SAMPLES, "metrics.json"),
  `${JSON.stringify({ host: process.platform, rows }, null, 2)}\n`,
);
process.stdout.write(`samples written to ${SAMPLES}\n`);
