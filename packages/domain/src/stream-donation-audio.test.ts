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
  STREAM_ALERT_DING_GAP_MS,
  STREAM_ALERT_DING_MS,
  streamDonationPlayingHoldMs,
  wavDurationMs,
} from "./stream-donation-audio.js";
import { StreamDonationInvalidRequestError } from "./errors.js";

test("playing hold includes the applepay ding duration", () => {
  const hold = streamDonationPlayingHoldMs({
    ttsStatus: "failed",
    ttsDurationMs: null,
  });
  assert.ok(STREAM_ALERT_DING_MS >= 1_410);
  assert.equal(hold, 45_000);
  const pending = streamDonationPlayingHoldMs({
    ttsStatus: "pending",
    ttsDurationMs: null,
  });
  assert.ok(pending > STREAM_ALERT_DING_MS + STREAM_ALERT_DING_GAP_MS);
});

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
  assert.throws(
    () => streamDonationAudioPath("/tmp/tts", "00000000-0000-4000-8000-000000000001", "../x"),
    StreamDonationInvalidRequestError,
  );
});

test("voice is part of the wav name so dmitri cannot satisfy ru_roman", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const dmitri = streamDonationAudioPath("/tmp/tts", id, "dmitri");
  const roman = streamDonationAudioPath("/tmp/tts", id, "ru_roman");
  assert.match(dmitri, /\.dmitri\.wav$/);
  assert.match(roman, /\.ru_roman\.wav$/);
  assert.notEqual(dmitri, roman);
});

test("old tts files are deleted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "giftbot-tts-"));
  const file = join(dir, "old.wav");
  await writeFile(file, encodeDonationDingWav());
  const removed = await cleanupOldStreamAlertTtsFiles(dir, 1, Date.now() + 10_000);
  assert.equal(removed, 1);
});
