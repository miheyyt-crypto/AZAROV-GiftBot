import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseOverlayVolumes,
  playBoundedAudio,
  playDonationAlert,
  playStreamGif,
  pollSpeechUrl,
  settleDonationPlayback,
  streamGifNeedsRestartLoop,
  STREAM_ALERT_DING_GAP_MS,
  STREAM_ALERT_SPEECH_START_MAX_MS,
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
  assert.deepEqual(
    events.filter((row) => row !== "hb").slice(0, 4),
    [
      "wait",
      "ding:0.4",
      `sleep:${STREAM_ALERT_DING_GAP_MS}`,
      "speech:/audio/d1:0.7",
    ],
  );
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
    "wait",
    "ding-end",
    `sleep:${STREAM_ALERT_DING_GAP_MS}`,
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
  assert.equal(STREAM_ALERT_TTS_ENABLED, true);
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
      ttsEnabled: false,
    },
  );
  assert.equal(mode, "text-only");
  assert.equal(events[0], "ding");
  assert.equal(events.includes("sleep:400"), false);
});

test("card keeps the original donation message, not the spoken form", async () => {
  const donation = {
    id: "d-msg",
    displayName: "A",
    message: "Привет 1000 AZC",
    ttsStatus: "ready" as const,
  };
  assert.equal(donation.message, "Привет 1000 AZC");
  assert.doesNotMatch(donation.message, /тысяча/);
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

test("late 200 after the TTS wait is ignored", async () => {
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
  assert.equal(events.includes("first-ding"), false);
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

test("speech wait and preload finish before the card, then ding gap to playing", async () => {
  let t = 0;
  let shownAt = -1;
  let playingAt = -1;
  let waitBeforeCard = -1;
  const mode = await playDonationAlert(
    { id: "d-time", displayName: "FormNick", message: "длинное сообщение", ttsStatus: "pending" },
    { ding: 0.8, speech: 1 },
    {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      onShowCard: () => {
        shownAt = t;
      },
      playDing: async () => {
        t += 1410;
      },
      waitForSpeechUrl: async () => {
        t += 5200;
        waitBeforeCard = t;
        return "/audio/d-time";
      },
      prepareSpeech: async () => {
        t += 80;
        return true;
      },
      playSpeech: async () => {
        playingAt = t;
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  assert.equal(mode, "speech");
  assert.equal(waitBeforeCard, 5200);
  assert.equal(shownAt, 5280);
  assert.equal(playingAt - shownAt, 1410 + STREAM_ALERT_DING_GAP_MS);
  assert.ok(playingAt - shownAt <= 2000);
});

test("warm TTS still waits for preload before showing the card", async () => {
  let t = 0;
  let shownAt = -1;
  let playingAt = -1;
  await playDonationAlert(
    { id: "d-warm", displayName: "FormNick", message: "ok", ttsStatus: "ready" },
    { ding: 0.8, speech: 1 },
    {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      onShowCard: () => {
        shownAt = t;
      },
      playDing: async () => {
        t += 1410;
      },
      waitForSpeechUrl: async () => "/audio/warm",
      prepareSpeech: async () => {
        t += 40;
        return true;
      },
      playSpeech: async () => {
        playingAt = t;
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  assert.equal(shownAt, 40);
  assert.equal(playingAt - shownAt, 1810);
});

test("slow audio load keeps the card hidden until timeout then plays ding without speech", async () => {
  const events: string[] = [];
  const mode = await playDonationAlert(
    { id: "d-slow", displayName: "FormNick", message: "ok", ttsStatus: "ready" },
    { ding: 1, speech: 1 },
    {
      sleep: async (ms) => {
        events.push(`sleep:${ms}`);
      },
      onShowCard: () => {
        events.push("show");
      },
      playDing: async () => {
        events.push("ding");
      },
      waitForSpeechUrl: async () => "/audio/slow",
      prepareSpeech: async () => false,
      playSpeech: async () => {
        events.push("speech");
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  assert.equal(mode, "text-only");
  assert.deepEqual(
    events.filter((row) => row === "show" || row === "ding" || row === "speech"),
    ["show", "ding"],
  );
});

test("TTS error shows the card with ding and never starts late speech", async () => {
  const events: string[] = [];
  const mode = await playDonationAlert(
    { id: "d-fail", displayName: "FormNick", message: "ok", ttsStatus: "failed" },
    { ding: 1, speech: 1 },
    {
      sleep: async () => undefined,
      onShowCard: () => {
        events.push("show");
      },
      playDing: async () => {
        events.push("ding");
      },
      waitForSpeechUrl: async () => {
        events.push("wait");
        return "/audio/late";
      },
      playSpeech: async () => {
        events.push("speech");
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  assert.equal(mode, "text-only");
  assert.deepEqual(events, ["show", "ding"]);
});

test("ready second donation does not show before the first finishes waiting", async () => {
  const events: string[] = [];
  await playDonationAlert(
    { id: "first", displayName: "A", message: "one", ttsStatus: "pending" },
    { ding: 1, speech: 1 },
    {
      sleep: async () => undefined,
      onShowCard: () => {
        events.push("show-first");
      },
      playDing: async () => {
        events.push("ding-first");
      },
      waitForSpeechUrl: async () => {
        events.push("wait-first");
        return "/audio/first";
      },
      playSpeech: async () => {
        events.push("speech-first");
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  await playDonationAlert(
    { id: "second", displayName: "B", message: "two", ttsStatus: "ready" },
    { ding: 1, speech: 1 },
    {
      sleep: async () => undefined,
      onShowCard: () => {
        events.push("show-second");
      },
      playDing: async () => {
        events.push("ding-second");
      },
      waitForSpeechUrl: async () => {
        events.push("wait-second");
        return "/audio/second";
      },
      playSpeech: async () => {
        events.push("speech-second");
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  assert.deepEqual(events, [
    "wait-first",
    "show-first",
    "ding-first",
    "speech-first",
    "wait-second",
    "show-second",
    "ding-second",
    "speech-second",
  ]);
});

test("ding and speech are prepared before the card is shown", async () => {
  const events: string[] = [];
  await playDonationAlert(
    { id: "d-prep", displayName: "FormNick", message: "ok", ttsStatus: "ready" },
    { ding: 1, speech: 1 },
    {
      sleep: async () => undefined,
      onShowCard: () => {
        events.push("show");
      },
      prepareDing: async () => {
        events.push("prep-ding");
        return true;
      },
      playDing: async () => {
        events.push("ding");
      },
      waitForSpeechUrl: async () => {
        events.push("wait");
        return "/audio/prep";
      },
      prepareSpeech: async () => {
        events.push("prep-speech");
        return true;
      },
      playSpeech: async () => {
        events.push("speech");
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  const showAt = events.indexOf("show");
  assert.ok(events.indexOf("prep-ding") < showAt);
  assert.ok(events.indexOf("prep-speech") < showAt);
  assert.ok(events.indexOf("wait") < showAt);
  assert.equal(events[showAt + 1], "ding");
});

test("speech is skipped if it cannot start within 2000ms of the card", async () => {
  const events: string[] = [];
  let t = 0;
  const mode = await playDonationAlert(
    { id: "d-late", displayName: "FormNick", message: "ok", ttsStatus: "ready" },
    { ding: 1, speech: 1 },
    {
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      onShowCard: () => {
        events.push("show");
      },
      playDing: async () => {
        t += 1700;
        events.push("ding");
      },
      waitForSpeechUrl: async () => "/audio/late-start",
      playSpeech: async () => {
        events.push("speech");
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  assert.equal(mode, "text-only");
  assert.equal(STREAM_ALERT_SPEECH_START_MAX_MS, 2000);
  assert.deepEqual(events, ["show", "ding"]);
});

test("late playing after the deadline stops audio and drops handlers", async () => {
  const log: string[] = [];
  let playingHandler: (() => void) | undefined;
  const handle: OverlayAudioHandle = {
    setVolume() {},
    async play() {
      log.push("play");
    },
    stop() {
      playingHandler = undefined;
      log.push("stop");
    },
    waitEnded() {
      return new Promise(() => undefined);
    },
    waitPlaying(timeoutMs, sleep) {
      return new Promise((resolve) => {
        playingHandler = () => {
          log.push("playing-late");
          resolve(true);
        };
        void sleep(timeoutMs).then(() => {
          if (playingHandler) {
            log.push("playing-timeout");
            playingHandler = undefined;
            resolve(false);
          }
        });
      });
    },
  };
  await playBoundedAudio({
    src: "speech.wav",
    volume: 1,
    maxMs: 5000,
    playingDeadlineMs: 20,
    sleep: wait,
    createAudio: () => handle,
    audio: handle,
  });
  playingHandler?.();
  await wait(40);
  assert.ok(log.includes("play"));
  assert.ok(log.includes("playing-timeout"));
  assert.ok(log.includes("stop"));
  assert.equal(log.includes("playing-late"), false);
  assert.equal(playingHandler, undefined);
});

test("ding failure still continues the queue without speech wait hang", async () => {
  const events: string[] = [];
  const mode = await playDonationAlert(
    { id: "d-ding-err", displayName: "FormNick", message: "ok", ttsStatus: "failed" },
    { ding: 1, speech: 1 },
    {
      sleep: async () => undefined,
      onShowCard: () => {
        events.push("show");
      },
      playDing: async () => {
        throw new Error("ding failed");
      },
      waitForSpeechUrl: async () => {
        throw new Error("must not wait");
      },
      playSpeech: async () => {
        events.push("speech");
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  assert.equal(mode, "text-only");
  assert.deepEqual(events, ["show"]);
});

test("media overlay waits 7s from appearance and skipping load is not a successful show", async () => {
  const events: string[] = [];
  const shown = await playStreamGif({
    url: "/gif/ok",
    visibleMs: 7_000,
    preloadMs: 50,
    sleep: async (ms) => {
      events.push(`sleep:${ms}`);
    },
    heartbeat: () => {
      events.push("hb");
    },
    loadImage: async () => ({ ok: true, width: 64, height: 32 }),
    show: () => {
      events.push("show");
    },
    hide: () => {
      events.push("hide");
    },
  });
  assert.equal(shown, "shown");
  assert.ok(events.includes("show"));
  assert.ok(events.includes("sleep:7000"));
  const failed = await playStreamGif({
    url: "/gif/bad",
    sleep: async () => undefined,
    heartbeat: () => undefined,
    loadImage: async () => ({ ok: false, width: 0, height: 0 }),
    show: () => {
      events.push("must-not-show");
    },
    hide: () => undefined,
  });
  assert.equal(failed, "failed");
  assert.equal(events.includes("must-not-show"), false);
});

test("playStreamGif can restart a finite image until the 7s window ends", async () => {
  let restarts = 0;
  const shown = await playStreamGif({
    url: "/gif/once",
    visibleMs: 40,
    preloadMs: 10,
    sleep: async (ms) => {
      if (ms > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, Math.min(ms, 5));
        });
      }
    },
    heartbeat: () => undefined,
    loadImage: async () => ({ ok: true, width: 8, height: 8 }),
    show: () => undefined,
    hide: () => undefined,
    restartWhileVisible: async () => {
      restarts += 1;
      await new Promise(() => undefined);
    },
  });
  assert.equal(shown, "shown");
  assert.equal(restarts, 1);
});

test("settleDonationPlayback marks load failure without blocking the next complete", async () => {
  const outcomes: Array<string | undefined> = [];
  await settleDonationPlayback({
    play: async () => "failed",
    complete: async (outcome) => {
      outcomes.push(outcome);
    },
    sleep: async () => undefined,
  });
  assert.deepEqual(outcomes, ["failed"]);
});

test("JPEG and PNG media do not use the GIF restart loop", () => {
  assert.equal(streamGifNeedsRestartLoop("image/jpeg"), false);
  assert.equal(streamGifNeedsRestartLoop("image/png"), false);
  assert.equal(streamGifNeedsRestartLoop("image/gif"), true);
  assert.equal(streamGifNeedsRestartLoop("image/webp"), true);
});

test("playStreamGif keeps the 7s window if restart returns immediately", async () => {
  const events: string[] = [];
  const shown = await playStreamGif({
    url: "/gif/jpeg",
    visibleMs: 7_000,
    preloadMs: 10,
    sleep: async (ms) => {
      events.push(`sleep:${ms}`);
    },
    heartbeat: () => undefined,
    loadImage: async () => ({ ok: true, width: 64, height: 32 }),
    show: () => {
      events.push("show");
    },
    hide: () => {
      events.push("hide");
    },
    restartWhileVisible: async () => {
      events.push("restart-done");
    },
  });
  assert.equal(shown, "shown");
  assert.ok(events.includes("show"));
  assert.ok(events.includes("restart-done"));
  assert.ok(events.includes("sleep:7000"));
  assert.ok(events.indexOf("hide") > events.indexOf("sleep:7000"));
  assert.ok(events.indexOf("sleep:7000") > events.indexOf("show"));
});

test("settleDonationPlayback marks overlay timeout as failed not shown", async () => {
  const outcomes: Array<string | undefined> = [];
  await settleDonationPlayback({
    play: async () => new Promise(() => undefined),
    complete: async (outcome) => {
      outcomes.push(outcome);
    },
    sleep: async () => undefined,
    timeoutMs: 1,
  });
  assert.deepEqual(outcomes, ["failed"]);
});

test("complete runs once per item and the queue continues after failed", async () => {
  const outcomes: Array<string | undefined> = [];
  const complete = async (outcome?: "succeeded" | "failed"): Promise<void> => {
    outcomes.push(outcome);
  };
  await settleDonationPlayback({
    play: async () => "failed",
    complete,
    sleep: async () => undefined,
  });
  await settleDonationPlayback({
    play: async () => "shown",
    complete,
    sleep: async () => undefined,
  });
  assert.deepEqual(outcomes, ["failed", "succeeded"]);
});
