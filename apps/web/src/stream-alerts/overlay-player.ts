import { STREAM_DONATION_VISIBLE_MS } from "./overlay-dom.js";

export const STREAM_ALERT_DING_GAP_MS = 400;
/** Watchdog only; applepay.mp3 is ~1.41s and must play to completion. */
export const STREAM_ALERT_DING_PLAY_MAX_MS = 10_000;
export const STREAM_ALERT_TTS_ENABLED = true;
export const STREAM_ALERT_TTS_WAIT_MS = 20_000;
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
};

export type OverlayVolumes = {
  ding: number;
  speech: number;
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
  const ding =
    dingRaw === null || dingRaw === "" ? 0.8 : Number(dingRaw) / 100;
  const speech =
    speechRaw === null || speechRaw === "" ? 1 : Number(speechRaw) / 100;
  return { ding: clampVolume(ding), speech: clampVolume(speech) };
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
};

export type OverlayPlaybackDeps = {
  sleep: (ms: number) => Promise<void>;
  playDing: (volume: number, signal?: AbortSignal) => Promise<void>;
  waitForSpeechUrl: (
    donationId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<string | null>;
  playSpeech: (
    url: string,
    volume: number,
    maxMs: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  heartbeat: (donationId: string) => Promise<void>;
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
}): Promise<void> {
  if (aborted(input.signal) || input.maxMs <= 0) {
    return;
  }
  const audio = input.createAudio(input.src);
  audio.setVolume(input.volume);
  const onAbort = (): void => {
    audio.stop();
  };
  input.signal?.addEventListener("abort", onAbort);
  try {
    await audio.play().catch(() => undefined);
    if (aborted(input.signal)) {
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
  let ended = false;
  const endedWaiters: Array<() => void> = [];
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
  el.addEventListener("ended", finishWaiters);
  el.addEventListener("error", finishWaiters);
  return {
    setVolume(volume) {
      el.volume = volume;
    },
    play() {
      return el.play().then(() => undefined);
    },
    stop() {
      el.pause();
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
  };
}

export async function playDonationAlert(
  donation: OverlayPlaybackDonation,
  volumes: OverlayVolumes,
  deps: OverlayPlaybackDeps,
): Promise<"speech" | "text-only"> {
  const signal = deps.signal;
  const heartbeat = windowSetIntervalSafe(() => {
    if (aborted(signal)) {
      return;
    }
    void deps.heartbeat(donation.id).catch(() => undefined);
  }, STREAM_ALERT_HEARTBEAT_MS);
  try {
    if (aborted(signal)) {
      return "text-only";
    }
    try {
      await deps.playDing(volumes.ding, signal);
    } catch {
      // Ding load/play failure must not block the overlay queue.
    }
    if (aborted(signal)) {
      return "text-only";
    }
    const ttsEnabled = deps.ttsEnabled ?? STREAM_ALERT_TTS_ENABLED;
    const skipWait =
      !ttsEnabled ||
      donation.ttsStatus === "failed" ||
      donation.ttsStatus === "skipped";
    if (!skipWait) {
      await deps.sleep(STREAM_ALERT_DING_GAP_MS);
      if (aborted(signal)) {
        return "text-only";
      }
    }
    const url = skipWait
      ? null
      : await deps.waitForSpeechUrl(
          donation.id,
          STREAM_ALERT_TTS_WAIT_MS,
          signal,
        );
    if (aborted(signal) || !url) {
      if (!aborted(signal)) {
        await deps.sleep(STREAM_DONATION_VISIBLE_MS);
      }
      return "text-only";
    }
    const duration = donation.ttsDurationMs ?? 0;
    const maxMs =
      duration > 0
        ? Math.min(STREAM_ALERT_TTS_PLAY_MAX_MS, duration + 2_000)
        : STREAM_ALERT_TTS_PLAY_MAX_MS;
    await deps.playSpeech(url, volumes.speech, maxMs, signal);
    return aborted(signal) ? "text-only" : "speech";
  } finally {
    heartbeat();
  }
}

export async function settleDonationPlayback(input: {
  play: (signal: AbortSignal) => Promise<void>;
  complete: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  timeoutMs?: number;
}): Promise<void> {
  const ac = new AbortController();
  try {
    await Promise.race([
      input.play(ac.signal),
      input.sleep(input.timeoutMs ?? STREAM_ALERT_COMPLETE_TIMEOUT_MS).then(() => {
        ac.abort();
      }),
    ]);
  } finally {
    ac.abort();
  }
  await input.complete();
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
