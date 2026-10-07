import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseOverlayVolumes,
  playBoundedAudio,
  playDonationAlert,
  pollSpeechUrl,
  settleDonationPlayback,
  STREAM_ALERT_DING_GAP_MS,
  STREAM_ALERT_TTS_ENABLED,
  type OverlayAudioHandle,
} from "./overlay-player.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
      ttsEnabled: true,
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

test("ding plays once and speech waits 400ms after ding ends", async () => {
  let dingCount = 0;
  const events: string[] = [];
  await playDonationAlert(
    { id: "d-once", displayName: "A", message: "ok", ttsStatus: "ready" },
    { ding: 0.8, speech: 1 },
    {
      sleep: async (ms) => {
        events.push(`sleep:${ms}`);
      },
      playDing: async () => {
        dingCount += 1;
        events.push("ding-end");
      },
      waitForSpeechUrl: async () => {
        events.push("wait");
        return "/audio/d-once";
      },
      playSpeech: async () => {
        events.push("speech");
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  assert.equal(dingCount, 1);
  assert.deepEqual(events, [
    "ding-end",
    `sleep:${STREAM_ALERT_DING_GAP_MS}`,
    "wait",
    "speech",
  ]);
});

test("TTS skipped still plays ding and does not wait for speech", async () => {
  const events: string[] = [];
  const mode = await playDonationAlert(
    { id: "d-off", displayName: "A", message: "text", ttsStatus: "skipped" },
    { ding: 0.5, speech: 1 },
    {
      sleep: async (ms) => {
        events.push(`sleep:${ms}`);
      },
      playDing: async (volume) => {
        events.push(`ding:${volume}`);
      },
      waitForSpeechUrl: async () => {
        throw new Error("must not wait for speech");
      },
      playSpeech: async () => {
        throw new Error("must not speak");
      },
      heartbeat: async () => undefined,
    },
  );
  assert.equal(mode, "text-only");
  assert.equal(events[0], "ding:0.5");
  assert.equal(events.includes(`sleep:${STREAM_ALERT_DING_GAP_MS}`), false);
  assert.ok(events.some((row) => row.startsWith("sleep:")));
});

test("ding play failure does not block speech", async () => {
  const events: string[] = [];
  const mode = await playDonationAlert(
    { id: "d-err", displayName: "A", message: "ok", ttsStatus: "ready" },
    { ding: 1, speech: 0.6 },
    {
      sleep: async () => undefined,
      playDing: async () => {
        throw new Error("failed to load ding");
      },
      waitForSpeechUrl: async () => "/audio/d-err",
      playSpeech: async (url, volume) => {
        events.push(`speech:${url}:${volume}`);
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  assert.equal(mode, "speech");
  assert.deepEqual(events, ["speech:/audio/d-err:0.6"]);
});

test("TTS kill switch skips speech wait even when status is pending", async () => {
  assert.equal(STREAM_ALERT_TTS_ENABLED, false);
  const events: string[] = [];
  const mode = await playDonationAlert(
    { id: "d-kill", displayName: "A", message: "ok", ttsStatus: "pending" },
    { ding: 1, speech: 1 },
    {
      sleep: async (ms) => {
        events.push(`sleep:${ms}`);
      },
      playDing: async () => {
        events.push("ding");
      },
      waitForSpeechUrl: async () => {
        throw new Error("must not wait for speech while TTS is disabled");
      },
      playSpeech: async () => {
        throw new Error("must not speak while TTS is disabled");
      },
      heartbeat: async () => undefined,
    },
  );
  assert.equal(mode, "text-only");
  assert.equal(events[0], "ding");
  assert.equal(events.includes("sleep:400"), false);
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
      ttsEnabled: true,
    },
  );
  assert.equal(mode, "text-only");
});

test("late 200 after the 12s TTS wait is ignored", async () => {
  const got = await pollSpeechUrl({
    url: "/stream-alerts/audio/late",
    timeoutMs: 40,
    pollMs: 10,
    sleep: wait,
    fetch: async (_url, init) => {
      await wait(80);
      if (init.signal?.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
      return { status: 200 };
    },
  });
  assert.equal(got, null);
});

test("stale first-donation speech does not play after timeout abort", async () => {
  const events: string[] = [];
  const ac = new AbortController();
  const first = playDonationAlert(
    { id: "first", displayName: "A", message: "one", ttsStatus: "pending" },
    { ding: 1, speech: 1 },
    {
      signal: ac.signal,
      sleep: (ms) => wait(Math.min(ms, 5)),
      playDing: async () => {
        events.push("first-ding");
      },
      waitForSpeechUrl: async (_id, _timeout, signal) => {
        events.push("first-wait");
        await wait(80);
        if (signal?.aborted) {
          events.push("first-stale-ignored");
          return null;
        }
        events.push("first-late-url");
        return "/audio/first-late";
      },
      playSpeech: async (url) => {
        events.push(`first-speech:${url}`);
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  await wait(20);
  ac.abort();
  assert.equal(await first, "text-only");
  const second = await playDonationAlert(
    { id: "second", displayName: "B", message: "two", ttsStatus: "ready" },
    { ding: 1, speech: 1 },
    {
      sleep: async () => undefined,
      playDing: async () => {
        events.push("second-ding");
      },
      waitForSpeechUrl: async () => "/audio/second",
      playSpeech: async (url) => {
        events.push(`second-speech:${url}`);
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  await wait(100);
  assert.equal(second, "speech");
  assert.equal(
    events.includes("first-speech:/audio/first-late"),
    false,
  );
  assert.ok(events.includes("first-stale-ignored"));
  assert.ok(events.includes("second-speech:/audio/second"));
});

test("aborted audio is stopped so the next donation cannot be overlapped", async () => {
  const log: string[] = [];
  function handle(src: string): OverlayAudioHandle {
    let stopped = false;
    return {
      setVolume() {},
      async play() {
        log.push(`play:${src}`);
      },
      stop() {
        stopped = true;
        log.push(`stop:${src}`);
      },
      waitEnded() {
        return new Promise((resolve) => {
          setTimeout(() => {
            if (!stopped) {
              log.push(`ended:${src}`);
            }
            resolve();
          }, 80);
        });
      },
    };
  }
  const ac = new AbortController();
  const first = playBoundedAudio({
    src: "a1",
    volume: 1,
    maxMs: 1000,
    signal: ac.signal,
    sleep: wait,
    createAudio: handle,
  });
  await wait(10);
  ac.abort();
  await first;
  await playBoundedAudio({
    src: "a2",
    volume: 1,
    maxMs: 20,
    sleep: wait,
    createAudio: handle,
  });
  await wait(100);
  assert.ok(log.includes("play:a1"));
  assert.ok(log.includes("stop:a1"));
  assert.ok(log.includes("play:a2"));
  assert.equal(log.includes("ended:a1"), false);
});

test("complete runs once after TTS timeout and late speech is dropped", async () => {
  let completes = 0;
  let speech = 0;
  await settleDonationPlayback({
    timeoutMs: 30,
    sleep: wait,
    play: async (signal) => {
      await playDonationAlert(
        { id: "first", displayName: "A", message: "late", ttsStatus: "pending" },
        { ding: 1, speech: 1 },
        {
          signal,
          sleep: (ms) => wait(Math.min(ms, 5)),
          playDing: async () => undefined,
          waitForSpeechUrl: async (_id, _timeout, playSignal) => {
            await wait(80);
            if (playSignal?.aborted) {
              return "/audio/late";
            }
            return "/audio/late";
          },
          playSpeech: async () => {
            speech += 1;
          },
          heartbeat: async () => undefined,
          ttsEnabled: true,
        },
      );
    },
    complete: async () => {
      completes += 1;
    },
  });
  await wait(100);
  assert.equal(completes, 1);
  assert.equal(speech, 0);
});
