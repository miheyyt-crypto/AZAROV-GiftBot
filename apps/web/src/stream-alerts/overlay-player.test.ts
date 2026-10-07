import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseOverlayVolumes,
  playDonationAlert,
  STREAM_ALERT_DING_GAP_MS,
} from "./overlay-player.js";

test("overlay volumes are independent 0–100 query params", () => {
  assert.deepEqual(parseOverlayVolumes(""), { ding: 0.8, speech: 1 });
  assert.deepEqual(parseOverlayVolumes("dingVolume=25&speechVolume=50"), {
    ding: 0.25,
    speech: 0.5,
  });
  assert.equal(parseOverlayVolumes("dingVolume=0").ding, 0);
  assert.equal(parseOverlayVolumes("speechVolume=150").speech, 1);
});

test("card sequence is ding, gap, then speech only", async () => {
  const events: string[] = [];
  const mode = await playDonationAlert(
    { id: "d1", displayName: "A", message: "привет", ttsStatus: "ready" },
    { ding: 0.4, speech: 0.7 },
    {
      sleep: async (ms) => {
        events.push(`sleep:${ms}`);
      },
      playDing: async (volume) => {
        events.push(`ding:${volume}`);
      },
      waitForSpeechUrl: async () => {
        events.push("wait");
        return "/audio/d1";
      },
      playSpeech: async (url, volume) => {
        events.push(`speech:${url}:${volume}`);
      },
      heartbeat: async () => {
        events.push("hb");
      },
    },
  );
  assert.equal(mode, "speech");
  assert.deepEqual(events.slice(0, 4), [
    "ding:0.4",
    `sleep:${STREAM_ALERT_DING_GAP_MS}`,
    "wait",
    "speech:/audio/d1:0.7",
  ]);
});

test("TTS timeout keeps the card as text and continues", async () => {
  const mode = await playDonationAlert(
    { id: "d2", displayName: "A", message: "без голоса", ttsStatus: "pending" },
    { ding: 1, speech: 1 },
    {
      sleep: async () => undefined,
      playDing: async () => undefined,
      waitForSpeechUrl: async () => null,
      playSpeech: async () => {
        throw new Error("must not speak");
      },
      heartbeat: async () => undefined,
    },
  );
  assert.equal(mode, "text-only");
});
