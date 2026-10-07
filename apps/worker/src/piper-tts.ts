import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { wavDurationMs } from "@giftbot/domain";

export type PiperRunInput = {
  bin: string;
  model: string;
  text: string;
  outputFile: string;
  timeoutMs: number;
};

let ttsChain: Promise<void> = Promise.resolve();

export function withOneTtsAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = ttsChain.then(fn, fn);
  ttsChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function spawnArgv(
  command: string,
  args: string[],
  input: { text: string; timeoutMs: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        OMP_NUM_THREADS: "1",
      },
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("piper timed out"));
    }, input.timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `piper exited ${code ?? "null"}${stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : ""}`,
        ),
      );
    });
    child.stdin.write(input.text, "utf8");
    child.stdin.end();
  });
}

export async function runPiper(input: PiperRunInput): Promise<number> {
  const args = ["--model", input.model, "--output_file", input.outputFile];
  if (process.platform !== "win32") {
    try {
      await spawnArgv("nice", ["-n", "15", input.bin, ...args], input);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ENOENT") {
        throw error;
      }
      await spawnArgv(input.bin, args, input);
    }
  } else {
    await spawnArgv(input.bin, args, input);
  }
  const bytes = await readFile(input.outputFile);
  return wavDurationMs(bytes);
}
