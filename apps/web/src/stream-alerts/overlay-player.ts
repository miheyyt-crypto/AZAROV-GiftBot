import { STREAM_DONATION_VISIBLE_MS } from "./overlay-dom.js";

export const STREAM_ALERT_DING_GAP_MS = 400;
/** Watchdog only; applepay.mp3 is ~1.41s and must play to completion. */
export const STREAM_ALERT_DING_PLAY_MAX_MS = 10_000;
export const STREAM_ALERT_TTS_ENABLED = true;
/** Poll + preload budget before the card is shown. */
export const STREAM_ALERT_TTS_WAIT_MS = 20_000;
/** From card appearance to HTMLAudioElement "playing". Late speech is aborted. */
export const STREAM_ALERT_SPEECH_START_MAX_MS = 2_000;
export const STREAM_ALERT_TTS_PLAY_MAX_MS = 90_000;
export const STREAM_ALERT_COMPLETE_TIMEOUT_MS = 120_000;
export const STREAM_ALERT_HEARTBEAT_MS = 8_000;
export const STREAM_ALERT_TTS_POLL_MS = 400;

export type OverlayTtsStatus = "pending" | "ready" | "failed" | "skipped";

export type OverlayPlaybackDonation = {
  id: string;
  displayName: string;
  message: string;
  ttsStatus?: OverlayTtsStatus;
  ttsDurationMs?: number | null;
  kind?: "donation" | "gif";
  mediaContentType?: string | null;
  mediaDurationMs?: number | null;
};

export type OverlayVolumes = {
  ding: number;
  speech: number;
  media?: number;
};

export function clampVolume(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.min(1, Math.max(0, raw));
}

export function parseOverlayVolumes(search: string): OverlayVolumes {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const dingRaw = params.get("dingVolume");
  const speechRaw = params.get("speechVolume");
  const mediaRaw = params.get("mediaVolume");
  const ding =
    dingRaw === null || dingRaw === "" ? 0.8 : Number(dingRaw) / 100;
  const speech =
    speechRaw === null || speechRaw === "" ? 1 : Number(speechRaw) / 100;
  const media =
    mediaRaw === null || mediaRaw === "" ? 1 : Number(mediaRaw) / 100;
  return {
    ding: clampVolume(ding),
    speech: clampVolume(speech),
    media: clampVolume(media),
  };
}

export type OverlayFetch = (
  url: string,
  init: { method: string; signal?: AbortSignal },
) => Promise<{ status: number }>;

export type OverlayAudioHandle = {
  setVolume: (volume: number) => void;
  play: () => Promise<void>;
  stop: () => void;
  waitEnded: () => Promise<void>;
  waitReady?: (
    timeoutMs: number,
    sleep: (ms: number) => Promise<void>,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  waitPlaying?: (
    timeoutMs: number,
    sleep: (ms: number) => Promise<void>,
    signal?: AbortSignal,
  ) => Promise<boolean>;
};

export type OverlayPlaybackDeps = {
  sleep: (ms: number) => Promise<void>;
  playDing: (volume: number, signal?: AbortSignal) => Promise<void>;
  waitForSpeechUrl: (
    donationId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<string | null>;
  prepareDing?: (
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  prepareSpeech?: (
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<boolean>;
  playSpeech: (
    url: string,
    volume: number,
    maxMs: number,
    signal?: AbortSignal,
    playingDeadlineMs?: number,
  ) => Promise<void>;
  heartbeat: (donationId: string) => Promise<void>;
  onShowCard?: () => void;
  now?: () => number;
  signal?: AbortSignal;
  ttsEnabled?: boolean;
};

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

export async function pollSpeechUrl(input: {
  url: string;
  timeoutMs: number;
  fetch: OverlayFetch;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  const now = input.now ?? Date.now;
  const started = now();
  const pollMs = input.pollMs ?? STREAM_ALERT_TTS_POLL_MS;
  while (now() - started < input.timeoutMs) {
    if (aborted(input.signal)) {
      return null;
    }
    const remaining = input.timeoutMs - (now() - started);
    if (remaining <= 0) {
      return null;
    }
    const ac = new AbortController();
    const onParentAbort = (): void => {
      ac.abort();
    };
    input.signal?.addEventListener("abort", onParentAbort, { once: true });
    let timedOut = false;
    const timeoutWait = input.sleep(remaining).then(() => {
      timedOut = true;
      ac.abort();
    });
    try {
      const response = await input.fetch(input.url, {
        method: "GET",
        signal: ac.signal,
      });
      if (timedOut || aborted(input.signal) || now() - started >= input.timeoutMs) {
        return null;
      }
      if (response.status === 200) {
        return input.url;
      }
      if (response.status !== 202) {
        return null;
      }
    } catch {
      if (timedOut || aborted(input.signal) || now() - started >= input.timeoutMs) {
        return null;
      }
      return null;
    } finally {
      input.signal?.removeEventListener("abort", onParentAbort);
      void timeoutWait;
    }
    const gap = Math.min(pollMs, Math.max(0, input.timeoutMs - (now() - started)));
    if (gap <= 0) {
      return null;
    }
    await input.sleep(gap);
  }
  return null;
}

export async function playBoundedAudio(input: {
  src: string;
  volume: number;
  maxMs: number;
  createAudio: (src: string) => OverlayAudioHandle;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  audio?: OverlayAudioHandle;
  playingDeadlineMs?: number;
}): Promise<void> {
  if (aborted(input.signal) || input.maxMs <= 0) {
    return;
  }
  if (input.playingDeadlineMs !== undefined && input.playingDeadlineMs <= 0) {
    return;
  }
  const audio = input.audio ?? input.createAudio(input.src);
  audio.setVolume(input.volume);
  const onAbort = (): void => {
    audio.stop();
  };
  input.signal?.addEventListener("abort", onAbort);
  try {
    const playingWait =
      input.playingDeadlineMs !== undefined && audio.waitPlaying
        ? audio.waitPlaying(input.playingDeadlineMs, input.sleep, input.signal)
        : Promise.resolve(true);
    await audio.play().catch(() => undefined);
    if (aborted(input.signal)) {
      return;
    }
    const started = await playingWait;
    if (!started || aborted(input.signal)) {
      return;
    }
    await Promise.race([
      audio.waitEnded(),
      input.sleep(input.maxMs),
      waitAbort(input.signal),
    ]);
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    audio.stop();
  }
}

export function createBrowserAudio(src: string): OverlayAudioHandle {
  const el = new Audio(src);
  el.preload = "auto";
  let ended = false;
  let stopped = false;
  const endedWaiters: Array<() => void> = [];
  const cleanups: Array<() => void> = [];
  const listen = (
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ): void => {
    el.addEventListener(type, handler, options);
    cleanups.push(() => {
      el.removeEventListener(type, handler);
    });
  };
  const finishWaiters = (): void => {
    if (ended) {
      return;
    }
    ended = true;
    for (const waiter of endedWaiters) {
      waiter();
    }
    endedWaiters.length = 0;
  };
  listen("ended", finishWaiters);
  listen("error", finishWaiters);
  const waitEvent = (
    type: "canplaythrough" | "playing",
    timeoutMs: number,
    sleep: (ms: number) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    if (stopped || aborted(signal) || timeoutMs <= 0) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean): void => {
        if (done) {
          return;
        }
        done = true;
        el.removeEventListener(type, onOk);
        el.removeEventListener("error", onErr);
        resolve(ok);
      };
      const onOk = (): void => {
        finish(!stopped);
      };
      const onErr = (): void => {
        finish(false);
      };
      el.addEventListener(type, onOk, { once: true });
      el.addEventListener("error", onErr, { once: true });
      void sleep(timeoutMs).then(() => {
        finish(false);
      });
      void waitAbort(signal).then(() => {
        finish(false);
      });
    });
  };
  return {
    setVolume(volume) {
      el.volume = volume;
    },
    play() {
      if (stopped) {
        return Promise.resolve();
      }
      return el.play().then(() => undefined);
    },
    stop() {
      stopped = true;
      el.pause();
      for (const cleanup of cleanups) {
        cleanup();
      }
      cleanups.length = 0;
      el.removeAttribute("src");
      el.load();
      finishWaiters();
    },
    waitEnded() {
      if (ended) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        endedWaiters.push(resolve);
      });
    },
    async waitReady(timeoutMs, sleep, signal) {
      if (stopped || aborted(signal) || timeoutMs <= 0) {
        return false;
      }
      if (el.readyState >= 4) {
        return true;
      }
      return waitEvent("canplaythrough", timeoutMs, sleep, signal);
    },
    async waitPlaying(timeoutMs, sleep, signal) {
      return waitEvent("playing", timeoutMs, sleep, signal);
    },
  };
}

export async function playDonationAlert(
  donation: OverlayPlaybackDonation,
  volumes: OverlayVolumes,
  deps: OverlayPlaybackDeps,
): Promise<"speech" | "text-only"> {
  const signal = deps.signal;
  const now = deps.now ?? Date.now;
  const beat = (): void => {
    if (aborted(signal)) {
      return;
    }
    void deps.heartbeat(donation.id).catch(() => undefined);
  };
  beat();
  const heartbeat = windowSetIntervalSafe(beat, STREAM_ALERT_HEARTBEAT_MS);
  try {
    if (aborted(signal)) {
      return "text-only";
    }
    const ttsEnabled = deps.ttsEnabled ?? STREAM_ALERT_TTS_ENABLED;
    const skipWait =
      !ttsEnabled ||
      donation.ttsStatus === "failed" ||
      donation.ttsStatus === "skipped";
    const waitStarted = now();
    const dingPrep = deps.prepareDing?.(STREAM_ALERT_TTS_WAIT_MS, signal);
    let url = skipWait
      ? null
      : await deps.waitForSpeechUrl(
          donation.id,
          STREAM_ALERT_TTS_WAIT_MS,
          signal,
        );
    const remaining = STREAM_ALERT_TTS_WAIT_MS - (now() - waitStarted);
    const speechPrep = ((): Promise<boolean> => {
      if (skipWait || !url || aborted(signal)) {
        return Promise.resolve(false);
      }
      if (!deps.prepareSpeech) {
        return Promise.resolve(true);
      }
      if (remaining <= 0) {
        return Promise.resolve(false);
      }
      return deps.prepareSpeech(url, remaining, signal);
    })();
    const [speechReady] = await Promise.all([
      speechPrep,
      dingPrep ?? Promise.resolve(true),
    ]);
    if (deps.prepareSpeech && !speechReady) {
      url = null;
    }
    if (aborted(signal)) {
      return "text-only";
    }
    const shownAt = now();
    deps.onShowCard?.();
    try {
      await deps.playDing(volumes.ding, signal);
    } catch {
      // Ding load/play failure must not block the overlay queue.
    }
    if (aborted(signal)) {
      return "text-only";
    }
    if (!url) {
      await deps.sleep(STREAM_DONATION_VISIBLE_MS);
      return "text-only";
    }
    await deps.sleep(STREAM_ALERT_DING_GAP_MS);
    if (aborted(signal)) {
      return "text-only";
    }
    const playingDeadlineMs =
      STREAM_ALERT_SPEECH_START_MAX_MS - (now() - shownAt);
    if (playingDeadlineMs <= 0) {
      return "text-only";
    }
    const duration = donation.ttsDurationMs ?? 0;
    const maxMs =
      duration > 0
        ? Math.min(STREAM_ALERT_TTS_PLAY_MAX_MS, duration + 2_000)
        : STREAM_ALERT_TTS_PLAY_MAX_MS;
    try {
      await deps.playSpeech(
        url,
        volumes.speech,
        maxMs,
        signal,
        playingDeadlineMs,
      );
    } catch {
      return "text-only";
    }
    return aborted(signal) ? "text-only" : "speech";
  } finally {
    heartbeat();
  }
}

export const STREAM_GIF_VISIBLE_MS = 7_000;
export const STREAM_GIF_PRELOAD_MS = 8_000;

export function streamGifNeedsRestartLoop(
  contentType: string | null | undefined,
): boolean {
  return contentType === "image/gif" || contentType === "image/webp";
}

export function overlayVideoShouldLoop(
  durationMs: number | null | undefined,
  visibleMs = STREAM_GIF_VISIBLE_MS,
): boolean {
  return (durationMs ?? 0) < visibleMs;
}

export type OverlayVideoHandle = {
  muted: boolean;
  volume: number;
  playsInline: boolean;
  loop: boolean;
  paused?: boolean;
  pause: () => void;
  load: () => void;
  play?: () => Promise<void>;
  removeAttribute: (name: string) => void;
};

export function applyOverlayVideoPlayback(
  el: OverlayVideoHandle,
  input: {
    volume: number;
    durationMs?: number | null;
    visibleMs?: number;
  },
): void {
  el.muted = false;
  el.playsInline = true;
  el.volume = clampVolume(input.volume);
  el.loop = overlayVideoShouldLoop(input.durationMs, input.visibleMs);
}

export function stopOverlayVideo(el: OverlayVideoHandle): void {
  el.pause();
  el.removeAttribute("src");
  el.load();
}

export async function playStreamGif(input: {
  url: string;
  visibleMs?: number;
  preloadMs?: number;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  heartbeat: () => void;
  loadImage: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<{ ok: boolean; width: number; height: number }>;
  show: (size: { width: number; height: number }) => void;
  hide: () => void;
  restartWhileVisible?: (signal: AbortSignal | undefined) => Promise<void>;
}): Promise<"shown" | "failed"> {
  const visibleMs = input.visibleMs ?? STREAM_GIF_VISIBLE_MS;
  const preloadMs = input.preloadMs ?? STREAM_GIF_PRELOAD_MS;
  input.heartbeat();
  if (aborted(input.signal)) {
    return "failed";
  }
  const loaded = await Promise.race([
    input.loadImage(input.url, input.signal),
    input.sleep(preloadMs).then(() => ({ ok: false, width: 0, height: 0 })),
  ]);
  if (!loaded.ok || aborted(input.signal)) {
    return "failed";
  }
  input.show({ width: loaded.width, height: loaded.height });
  input.heartbeat();
  try {
    const visible = Promise.race([
      input.sleep(visibleMs),
      waitAbort(input.signal),
    ]);
    if (input.restartWhileVisible) {
      void input.restartWhileVisible(input.signal).catch(() => undefined);
    }
    await visible;
  } finally {
    input.hide();
  }
  return aborted(input.signal) ? "failed" : "shown";
}

export async function settleDonationPlayback(input: {
  play: (signal: AbortSignal) => Promise<void | "failed" | "shown">;
  complete: (outcome?: "succeeded" | "failed") => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  timeoutMs?: number;
  onAbortController?: (ac: AbortController) => void;
}): Promise<void> {
  const ac = new AbortController();
  input.onAbortController?.(ac);
  let result: void | "failed" | "shown" | "timeout" = "shown";
  try {
    result = await Promise.race([
      input.play(ac.signal),
      input.sleep(input.timeoutMs ?? STREAM_ALERT_COMPLETE_TIMEOUT_MS).then(() => {
        ac.abort();
        return "timeout" as const;
      }),
    ]);
  } finally {
    ac.abort();
  }
  await input.complete(
    result === "failed" || result === "timeout" ? "failed" : "succeeded",
  );
}

function waitAbort(signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise(() => undefined);
  }
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function windowSetIntervalSafe(fn: () => void, ms: number): () => void {
  const timer = setInterval(fn, ms);
  return () => {
    clearInterval(timer);
  };
}
