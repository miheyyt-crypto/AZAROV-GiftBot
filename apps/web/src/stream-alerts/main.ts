import {
  DONATION_ALERT_AUDIO_SRC,
  DONATION_ALERT_ICON_SRC,
  STREAM_DONATION_FADE_MS,
  fillAlertTexts,
  overlaySessionId,
} from "./overlay-dom.js";
import {
  applyOverlayVideoPlayback,
  createBrowserAudio,
  parseOverlayVolumes,
  playBoundedAudio,
  playDonationAlert,
  playStreamGif,
  pollSpeechUrl,
  settleDonationPlayback,
  stopOverlayVideo,
  streamGifNeedsRestartLoop,
  STREAM_ALERT_DING_PLAY_MAX_MS,
  type OverlayAudioHandle,
  type OverlayPlaybackDonation,
  type OverlayTtsStatus,
} from "./overlay-player.js";
import "./overlay.css";

const token = new URLSearchParams(window.location.search).get("token") ?? "";
const volumes = parseOverlayVolumes(window.location.search);
const sessionId = overlaySessionId(window.sessionStorage);

const root = document.getElementById("alert");
const icon = document.getElementById("alert-icon") as HTMLImageElement | null;
const gifEl = document.getElementById("alert-gif") as HTMLImageElement | null;
const mediaEl = document.getElementById("alert-media") as HTMLVideoElement | null;
const nameEl = document.getElementById("alert-name");
const messageEl = document.getElementById("alert-message");
let currentPlayingId: string | null = null;
let playbackAbort: AbortController | null = null;

if (icon) {
  icon.src = DONATION_ALERT_ICON_SRC;
  icon.alt = "";
  icon.addEventListener("error", () => {
    icon.style.visibility = "hidden";
  });
}

function overlayUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  if (token) {
    url.searchParams.set("token", token);
  }
  return `${url.pathname}${url.search}`;
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(overlayUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const error = new Error(
      typeof payload.message === "string" ? payload.message : "overlay request failed",
    ) as Error & { code?: string };
    if (typeof payload.error === "string") {
      error.code = payload.error;
    }
    throw error;
  }
  return payload;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function playHtmlAudio(
  src: string,
  volume: number,
  maxMs: number,
  signal?: AbortSignal,
  playingDeadlineMs?: number,
): Promise<void> {
  return playBoundedAudio({
    src,
    volume,
    maxMs,
    sleep,
    createAudio: createBrowserAudio,
    ...(signal ? { signal } : {}),
    ...(playingDeadlineMs !== undefined ? { playingDeadlineMs } : {}),
  });
}

function waitForSpeechUrl(
  donationId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  return pollSpeechUrl({
    url: overlayUrl(`/stream-alerts/audio/${donationId}`),
    timeoutMs,
    fetch: (url, init) => fetch(url, init),
    sleep,
    ...(signal ? { signal } : {}),
  });
}

async function showDonation(
  donation: OverlayPlaybackDonation,
  signal: AbortSignal,
): Promise<void> {
  if (!root || !nameEl || !messageEl) {
    return;
  }
  fillAlertTexts(nameEl, messageEl, donation);
  const preparedDing: { current: OverlayAudioHandle | null } = { current: null };
  const preparedSpeech: { current: OverlayAudioHandle | null } = {
    current: null,
  };
  try {
    await playDonationAlert(donation, volumes, {
      signal,
      sleep,
      onShowCard: () => {
        root.classList.remove("is-out");
        root.classList.add("is-in");
        root.setAttribute("data-visible", "true");
      },
      prepareDing: async (timeoutMs, playSignal) => {
        preparedDing.current?.stop();
        const audio = createBrowserAudio(DONATION_ALERT_AUDIO_SRC);
        preparedDing.current = audio;
        const ready = await audio.waitReady?.(timeoutMs, sleep, playSignal);
        if (!ready) {
          audio.stop();
          preparedDing.current = null;
          return false;
        }
        return true;
      },
      playDing: (volume, playSignal) => {
        const audio = preparedDing.current;
        preparedDing.current = null;
        if (audio) {
          return playBoundedAudio({
            src: DONATION_ALERT_AUDIO_SRC,
            volume,
            maxMs: STREAM_ALERT_DING_PLAY_MAX_MS,
            sleep,
            createAudio: () => audio,
            audio,
            ...(playSignal ? { signal: playSignal } : {}),
          });
        }
        return playHtmlAudio(
          DONATION_ALERT_AUDIO_SRC,
          volume,
          STREAM_ALERT_DING_PLAY_MAX_MS,
          playSignal,
        );
      },
      waitForSpeechUrl,
      prepareSpeech: async (url, timeoutMs, playSignal) => {
        preparedSpeech.current?.stop();
        const audio = createBrowserAudio(url);
        preparedSpeech.current = audio;
        const ready = await audio.waitReady?.(timeoutMs, sleep, playSignal);
        if (!ready) {
          audio.stop();
          preparedSpeech.current = null;
          return false;
        }
        return true;
      },
      playSpeech: (url, volume, maxMs, playSignal, playingDeadlineMs) => {
        const audio = preparedSpeech.current;
        preparedSpeech.current = null;
        if (audio) {
          return playBoundedAudio({
            src: url,
            volume,
            maxMs,
            sleep,
            createAudio: () => audio,
            audio,
            ...(playSignal ? { signal: playSignal } : {}),
            ...(playingDeadlineMs !== undefined ? { playingDeadlineMs } : {}),
          });
        }
        return playHtmlAudio(url, volume, maxMs, playSignal, playingDeadlineMs);
      },
      heartbeat: async (donationId) => {
        await postJson("/stream-alerts/heartbeat", { sessionId, donationId });
      },
    });
  } finally {
    preparedDing.current?.stop();
    preparedDing.current = null;
    preparedSpeech.current?.stop();
    preparedSpeech.current = null;
    root.classList.remove("is-in");
    root.classList.add("is-out");
    if (!signal.aborted) {
      await sleep(STREAM_DONATION_FADE_MS);
    }
    root.classList.remove("is-out");
    root.removeAttribute("data-visible");
    nameEl.textContent = "";
    messageEl.textContent = "";
  }
}

function readClaimedDonation(raw: unknown): OverlayPlaybackDonation | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string") {
    return null;
  }
  const ttsStatus = row.ttsStatus;
  return {
    id: row.id,
    displayName: typeof row.displayName === "string" ? row.displayName : "",
    message: typeof row.message === "string" ? row.message : "",
    ...(ttsStatus === "pending" ||
    ttsStatus === "ready" ||
    ttsStatus === "failed" ||
    ttsStatus === "skipped"
      ? { ttsStatus: ttsStatus as OverlayTtsStatus }
      : {}),
    ttsDurationMs:
      typeof row.ttsDurationMs === "number" ? row.ttsDurationMs : null,
    ...(row.kind === "gif" ? { kind: "gif" as const } : { kind: "donation" as const }),
    mediaContentType:
      typeof row.mediaContentType === "string" ? row.mediaContentType : null,
    mediaDurationMs:
      typeof row.mediaDurationMs === "number" ? row.mediaDurationMs : null,
  };
}

let pumping = false;
let eventsSource: EventSource | null = null;
let eventsReconnectTimer = 0;

async function completeDonation(
  donationId: string,
  outcome?: "succeeded" | "failed",
): Promise<void> {
  try {
    await postJson("/stream-alerts/complete", {
      sessionId,
      donationId,
      ...(outcome ? { playbackOutcome: outcome } : {}),
    });
  } catch {
    // Queue recovery via playing lease if complete cannot be delivered.
  }
}

function loadGifImage(
  url: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; width: number; height: number }> {
  return new Promise((resolve) => {
    if (!gifEl) {
      resolve({ ok: false, width: 0, height: 0 });
      return;
    }
    const image = gifEl;
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      image.onload = null;
      image.onerror = null;
      resolve({
        ok,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onload = () => {
      finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    };
    image.onerror = () => {
      finish(false);
    };
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          image.removeAttribute("src");
          finish(false);
        },
        { once: true },
      );
    }
    image.src = url;
  });
}

function loadOverlayVideo(
  url: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; width: number; height: number }> {
  return new Promise((resolve) => {
    if (!mediaEl) {
      resolve({ ok: false, width: 0, height: 0 });
      return;
    }
    const video = mediaEl;
    video.muted = false;
    video.volume = volumes.media ?? 1;
    video.playsInline = true;
    video.preload = "auto";
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      video.onloadeddata = null;
      video.onerror = null;
      resolve({
        ok,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };
    video.onloadeddata = () => {
      finish(video.videoWidth > 0 && video.videoHeight > 0);
    };
    video.onerror = () => {
      finish(false);
    };
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          stopOverlayVideo(video);
          finish(false);
        },
        { once: true },
      );
    }
    video.src = url;
  });
}

async function restartFiniteImage(
  el: HTMLImageElement,
  url: string,
  signal?: AbortSignal,
  contentType?: string | null,
): Promise<void> {
  if (!streamGifNeedsRestartLoop(contentType)) {
    return new Promise(() => undefined);
  }
  const ImageDecoderCtor = (
    globalThis as unknown as {
      ImageDecoder?: new (init: { data: BufferSource; type: string }) => {
        completed: Promise<void>;
        tracks: {
          selectedTrack: {
            frameCount: number;
            repetitionCount: number;
          } | null;
        };
        decode: (opts: { frameIndex: number }) => Promise<{
          image: { duration: number; close: () => void };
        }>;
      };
    }
  ).ImageDecoder;
  if (!ImageDecoderCtor || !signal) {
    return new Promise(() => undefined);
  }
  try {
    const response = await fetch(url, { signal });
    const data = await response.arrayBuffer();
    const type =
      contentType === "image/webp" || url.toLowerCase().includes(".webp")
        ? "image/webp"
        : "image/gif";
    const decoder = new ImageDecoderCtor({ data, type });
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track || track.repetitionCount < 0 || track.repetitionCount > 0) {
      return new Promise(() => undefined);
    }
    while (!signal.aborted) {
      el.src = url;
      let totalUs = 0;
      for (let i = 0; i < track.frameCount; i += 1) {
        const frame = await decoder.decode({ frameIndex: i });
        totalUs += frame.image.duration;
        frame.image.close();
      }
      await sleep(Math.max(80, Math.round(totalUs / 1000)));
    }
  } catch {
    return;
  }
}

function isOverlayVideo(type: string | null | undefined): boolean {
  return typeof type === "string" && type.startsWith("video/");
}

async function showGif(
  donation: OverlayPlaybackDonation,
  signal: AbortSignal,
): Promise<"shown" | "failed"> {
  if (!root || !gifEl || !mediaEl) {
    return "failed";
  }
  const url = overlayUrl(`/stream-alerts/gif/${donation.id}`);
  const video = isOverlayVideo(donation.mediaContentType);
  return playStreamGif({
    url,
    signal,
    sleep,
    heartbeat: () => {
      void postJson("/stream-alerts/heartbeat", {
        sessionId,
        donationId: donation.id,
      }).catch(() => undefined);
    },
    loadImage: video ? loadOverlayVideo : loadGifImage,
    ...(video || !streamGifNeedsRestartLoop(donation.mediaContentType)
      ? {}
      : {
          restartWhileVisible: (playSignal: AbortSignal | undefined) =>
            restartFiniteImage(gifEl, url, playSignal, donation.mediaContentType),
        }),
    show: () => {
      root.setAttribute("data-kind", "gif");
      root.setAttribute("data-media", video ? "video" : "image");
      root.classList.remove("is-out");
      root.classList.add("is-in");
      root.setAttribute("data-visible", "true");
      if (video) {
        applyOverlayVideoPlayback(mediaEl, {
          volume: volumes.media ?? 1,
          ...(donation.mediaDurationMs !== undefined
            ? { durationMs: donation.mediaDurationMs }
            : {}),
        });
        void mediaEl.play().catch(() => undefined);
      }
    },
    hide: () => {
      root.classList.remove("is-in");
      root.classList.add("is-out");
      gifEl.removeAttribute("src");
      stopOverlayVideo(mediaEl);
      root.removeAttribute("data-kind");
      root.removeAttribute("data-media");
      root.classList.remove("is-out");
      root.removeAttribute("data-visible");
    },
  });
}

async function pumpQueue(): Promise<void> {
  if (pumping) {
    return;
  }
  pumping = true;
  try {
    for (;;) {
      const claimed = await postJson("/stream-alerts/claim", {
        sessionId,
        supportsGif: true,
        supportsVideo: true,
        capabilities: ["gif", "video"],
      });
      const donation = readClaimedDonation(claimed.donation);
      if (!donation) {
        return;
      }
      currentPlayingId = donation.id;
      await settleDonationPlayback({
        play: (playSignal) =>
          donation.kind === "gif"
            ? showGif(donation, playSignal)
            : showDonation(donation, playSignal),
        complete: (outcome) => completeDonation(donation.id, outcome),
        sleep,
        onAbortController: (ac) => {
          playbackAbort = ac;
        },
      });
      currentPlayingId = null;
      playbackAbort = null;
    }
  } catch {
    await sleep(2000);
  } finally {
    pumping = false;
  }
}

async function attach(): Promise<void> {
  try {
    await postJson("/stream-alerts/attach", { sessionId });
    if (!pumping) {
      void pumpQueue();
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "OVERLAY_BUSY") {
      await sleep(5000);
    }
  }
}

function connectEvents(): void {
  if (eventsSource) {
    eventsSource.close();
    eventsSource = null;
  }
  const source = new EventSource(overlayUrl("/stream-alerts/events"));
  eventsSource = source;
  source.addEventListener("queued", () => {
    void pumpQueue();
  });
  source.addEventListener("dismissed", (event) => {
    const payload = JSON.parse((event as MessageEvent).data || "{}") as {
      donationId?: string;
    };
    if (payload.donationId && payload.donationId === currentPlayingId) {
      playbackAbort?.abort();
    }
    void pumpQueue();
  });
  source.addEventListener("ready", () => {
    void pumpQueue();
  });
  source.onerror = () => {
    source.close();
    if (eventsSource === source) {
      eventsSource = null;
    }
    window.clearTimeout(eventsReconnectTimer);
    eventsReconnectTimer = window.setTimeout(() => {
      connectEvents();
      void pumpQueue();
    }, 2000);
  };
}

void (async () => {
  await attach();
  window.setInterval(() => {
    void attach();
  }, 10_000);
  connectEvents();
})();
