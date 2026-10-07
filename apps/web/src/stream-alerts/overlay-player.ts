import { STREAM_DONATION_VISIBLE_MS } from "./overlay-dom.js";

export const STREAM_ALERT_DING_GAP_MS = 400;
export const STREAM_ALERT_TTS_WAIT_MS = 12_000;
export const STREAM_ALERT_TTS_PLAY_MAX_MS = 90_000;
export const STREAM_ALERT_COMPLETE_TIMEOUT_MS = 120_000;
export const STREAM_ALERT_HEARTBEAT_MS = 8_000;

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

export type OverlayPlaybackDeps = {
  sleep: (ms: number) => Promise<void>;
  playDing: (volume: number) => Promise<void>;
  waitForSpeechUrl: (
    donationId: string,
    timeoutMs: number,
  ) => Promise<string | null>;
  playSpeech: (url: string, volume: number, maxMs: number) => Promise<void>;
  heartbeat: (donationId: string) => Promise<void>;
};

export async function playDonationAlert(
  donation: OverlayPlaybackDonation,
  volumes: OverlayVolumes,
  deps: OverlayPlaybackDeps,
): Promise<"speech" | "text-only"> {
  const heartbeat = windowSetIntervalSafe(() => {
    void deps.heartbeat(donation.id).catch(() => undefined);
  }, STREAM_ALERT_HEARTBEAT_MS);
  try {
    await deps.playDing(volumes.ding);
    await deps.sleep(STREAM_ALERT_DING_GAP_MS);
    const skipWait =
      donation.ttsStatus === "failed" || donation.ttsStatus === "skipped";
    const url = skipWait
      ? null
      : await deps.waitForSpeechUrl(donation.id, STREAM_ALERT_TTS_WAIT_MS);
    if (!url) {
      await deps.sleep(STREAM_DONATION_VISIBLE_MS);
      return "text-only";
    }
    const duration = donation.ttsDurationMs ?? 0;
    const maxMs =
      duration > 0
        ? Math.min(STREAM_ALERT_TTS_PLAY_MAX_MS, duration + 2_000)
        : STREAM_ALERT_TTS_PLAY_MAX_MS;
    await deps.playSpeech(url, volumes.speech, maxMs);
    return "speech";
  } finally {
    heartbeat();
  }
}

function windowSetIntervalSafe(fn: () => void, ms: number): () => void {
  const timer = setInterval(fn, ms);
  return () => {
    clearInterval(timer);
  };
}
