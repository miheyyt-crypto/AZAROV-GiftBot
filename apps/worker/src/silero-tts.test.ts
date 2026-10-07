import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runSilero, stopSileroWorker } from "./silero-tts.js";

const mock = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "tts",
  "silero-hang-mock.py",
);

after(() => {
  stopSileroWorker();
});

test("hung synth is killed and does not answer the next job", async () => {
  const dir = await mkdtemp(join(tmpdir(), "giftbot-silero-hang-"));
  const python = process.platform === "win32" ? "python" : "python3";
  const base = {
    python,
    script: mock,
    model: join(dir, "unused.pt"),
    speaker: "ru_roman",
    outputFile: join(dir, "out.wav"),
  };
  const t0 = Date.now();
  await assert.rejects(
    () =>
      runSilero({
        ...base,
        text: "first",
        timeoutMs: 400,
      }),
    /silero timed out/,
  );
  const firstMs = Date.now() - t0;
  assert.ok(firstMs < 2_500, `timeout should free the queue quickly, took ${firstMs}ms`);
  const t1 = Date.now();
  const duration = await runSilero({
    ...base,
    text: "second",
    timeoutMs: 3_000,
  });
  const secondMs = Date.now() - t1;
  assert.equal(duration, 42);
  assert.ok(secondMs < 2_500, `second job got a late first reply or hung, took ${secondMs}ms`);
});
