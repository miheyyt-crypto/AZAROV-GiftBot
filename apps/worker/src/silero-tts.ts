import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { wavDurationMs } from "@giftbot/domain";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "tts",
  "silero_worker.py",
);

export const DEFAULT_SILERO_SPEAKER = "ru_roman";
export const DEFAULT_SILERO_SAMPLE_RATE = 48_000;

export type SileroRunInput = {
  python: string;
  model: string;
  speaker: string;
  text: string;
  outputFile: string;
  timeoutMs: number;
  sampleRate?: number;
  threads?: number;
  script?: string;
};

type SileroReply = {
  ok?: boolean;
  error?: string;
  duration_ms?: number;
  event?: string;
  id?: number;
};

let child: ChildProcessWithoutNullStreams | undefined;
let childKey: string | undefined;
let epoch = 0;
let nextReqId = 1;
let buffer = "";
let waiter:
  | { epoch: number; reqId: number; resolve: (line: string) => void }
  | undefined;

function envForPython(threads: number): NodeJS.ProcessEnv {
  const n = String(Math.max(1, threads));
  return {
    ...process.env,
    OMP_NUM_THREADS: n,
    MKL_NUM_THREADS: n,
    OPENBLAS_NUM_THREADS: n,
    NUMEXPR_NUM_THREADS: n,
  };
}

function killProcessTree(proc: ChildProcessWithoutNullStreams): void {
  const pid = proc.pid;
  if (pid && process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // Process may not be a group leader.
    }
  }
  proc.kill("SIGKILL");
}

export function stopSileroWorker(): void {
  epoch += 1;
  waiter = undefined;
  buffer = "";
  childKey = undefined;
  const proc = child;
  child = undefined;
  if (!proc) {
    return;
  }
  try {
    proc.stdout.destroy();
    proc.stderr.destroy();
    proc.stdin.destroy();
  } catch {
    // Ignore stdio already closed.
  }
  killProcessTree(proc);
}

function attach(proc: ChildProcessWithoutNullStreams, bornEpoch: number): void {
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    if (bornEpoch !== epoch || child !== proc) {
      return;
    }
    buffer += chunk;
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      const current = waiter;
      if (!current || current.epoch !== epoch) {
        nl = buffer.indexOf("\n");
        continue;
      }
      let parsed: SileroReply | undefined;
      try {
        parsed = JSON.parse(line) as SileroReply;
      } catch {
        nl = buffer.indexOf("\n");
        continue;
      }
      if (
        parsed.id !== undefined &&
        current.reqId !== 0 &&
        parsed.id !== current.reqId
      ) {
        nl = buffer.indexOf("\n");
        continue;
      }
      waiter = undefined;
      current.resolve(line);
      nl = buffer.indexOf("\n");
    }
  });
  proc.on("exit", () => {
    if (child === proc) {
      child = undefined;
      childKey = undefined;
    }
    if (waiter && waiter.epoch === bornEpoch) {
      const current = waiter;
      waiter = undefined;
      current.resolve("");
    }
  });
}

function waitLine(timeoutMs: number, reqId: number): Promise<string> {
  const born = epoch;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (waiter?.epoch === born && waiter.reqId === reqId) {
        waiter = undefined;
      }
      stopSileroWorker();
      reject(new Error("silero timed out"));
    }, timeoutMs);
    waiter = {
      epoch: born,
      reqId,
      resolve: (line) => {
        clearTimeout(timer);
        resolve(line);
      },
    };
  });
}

function parseReply(line: string): SileroReply {
  if (!line) {
    throw new Error("silero worker exited");
  }
  const parsed = JSON.parse(line) as SileroReply;
  if (!parsed.ok) {
    throw new Error(parsed.error ?? "silero failed");
  }
  return parsed;
}

async function ensureWorker(input: SileroRunInput): Promise<void> {
  const threads = input.threads ?? 1;
  const sampleRate = input.sampleRate ?? DEFAULT_SILERO_SAMPLE_RATE;
  const script = input.script ?? SCRIPT;
  const key = `${input.python}|${script}|${input.model}|${input.speaker}|${sampleRate}|${threads}`;
  if (child && childKey === key) {
    return;
  }
  stopSileroWorker();
  const readyWait = waitLine(input.timeoutMs, 0);
  const args = [
    "-u",
    script,
    "--model",
    input.model,
    "--speaker",
    input.speaker,
    "--sample-rate",
    String(sampleRate),
    "--threads",
    String(threads),
  ];
  const proc = spawn(input.python, args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
    env: envForPython(threads),
  });
  const bornEpoch = epoch;
  child = proc;
  childKey = key;
  proc.on("error", () => {
    if (waiter?.epoch === bornEpoch) {
      const current = waiter;
      waiter = undefined;
      current.resolve("");
    }
  });
  attach(proc, bornEpoch);
  const ready = parseReply(await readyWait);
  if (ready.event !== "ready") {
    stopSileroWorker();
    throw new Error("silero worker did not become ready");
  }
}

export async function runSilero(input: SileroRunInput): Promise<number> {
  const reqId = nextReqId;
  nextReqId += 1;
  try {
    await ensureWorker(input);
    if (!child) {
      throw new Error("silero worker missing");
    }
    child.stdin.write(
      `${JSON.stringify({
        cmd: "synth",
        id: reqId,
        text: input.text,
        output: input.outputFile,
      })}\n`,
    );
    const reply = parseReply(await waitLine(input.timeoutMs, reqId));
    if (typeof reply.duration_ms === "number" && reply.duration_ms > 0) {
      return reply.duration_ms;
    }
    const bytes = await readFile(input.outputFile);
    return wavDurationMs(bytes);
  } catch (error) {
    stopSileroWorker();
    throw error;
  }
}
