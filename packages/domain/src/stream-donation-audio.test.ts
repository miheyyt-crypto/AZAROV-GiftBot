import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  cleanupOldStreamAlertTtsFiles,
  encodeDonationDingWav,
  encodePcmWav,
  streamDonationAudioPath,
  streamDonationPlayingHoldMs,
  wavDurationMs,
} from "./stream-donation-audio.js";
import { StreamDonationInvalidRequestError } from "./errors.js";

test("ready speech hold outlives the 45s fallback lease", () => {
  const hold = streamDonationPlayingHoldMs({
    ttsStatus: "ready",
    ttsDurationMs: 60_000,
  });
  assert.ok(hold > 45_000);
  assert.ok(hold < 180_000);
});

test("wav duration matches pcm header", () => {
  const samples = new Int16Array(22_050);
  const wav = encodePcmWav(samples, 22_050);
  assert.equal(wavDurationMs(wav), 1000);
  assert.ok(encodeDonationDingWav().length > 44);
});

test("audio path rejects traversal", () => {
  assert.throws(
    () => streamDonationAudioPath("/tmp/tts", "../secret"),
    StreamDonationInvalidRequestError,
  );
});

test("old tts files are deleted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "giftbot-tts-"));
  const file = join(dir, "old.wav");
  await writeFile(file, encodeDonationDingWav());
  const removed = await cleanupOldStreamAlertTtsFiles(dir, 1, Date.now() + 10_000);
  assert.equal(removed, 1);
});
