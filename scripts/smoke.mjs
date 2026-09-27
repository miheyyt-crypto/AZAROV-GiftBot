import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const processes = [
  {
    name: "api",
    script: path.join(root, "apps/api/dist/main.js"),
    url: "http://127.0.0.1:3000/health/live",
  },
  {
    name: "bot",
    script: path.join(root, "apps/bot/dist/main.js"),
    url: "http://127.0.0.1:3001/health/live",
  },
  {
    name: "worker",
    script: path.join(root, "apps/worker/dist/main.js"),
    url: "http://127.0.0.1:3002/health/live",
  },
];

function start(script) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  return child;
}

async function waitForLive(url, name) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.json();

      if (
        response.ok &&
        body.status === "live" &&
        body.process === name
      ) {
        return;
      }
    } catch {
      // Process is still binding the port.
    }

    await sleep(150);
  }

  throw new Error(`${name} did not become live at ${url}`);
}

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  child.kill("SIGTERM");
  return once(child, "exit").then(() => undefined);
}

const children = processes.map((item) => start(item.script));

try {
  for (const item of processes) {
    await waitForLive(item.url, item.name);
    process.stdout.write(
      `${JSON.stringify({ level: "info", msg: "smoke live ok", process: item.name })}\n`,
    );
  }
} finally {
  await Promise.all(children.map((child) => stop(child)));
}
