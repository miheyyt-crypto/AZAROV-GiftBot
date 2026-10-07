import {
  DONATION_ALERT_AUDIO_SRC,
  DONATION_ALERT_ICON_SRC,
  STREAM_DONATION_FADE_MS,
  fillAlertTexts,
  overlaySessionId,
} from "./overlay-dom.js";
import {
  createBrowserAudio,
  parseOverlayVolumes,
  playBoundedAudio,
  playDonationAlert,
  pollSpeechUrl,
  settleDonationPlayback,
  STREAM_ALERT_DING_PLAY_MAX_MS,
  type OverlayPlaybackDonation,
  type OverlayTtsStatus,
} from "./overlay-player.js";
import "./overlay.css";

const token = new URLSearchParams(window.location.search).get("token") ?? "";
const volumes = parseOverlayVolumes(window.location.search);
const sessionId = overlaySessionId(window.sessionStorage);

const root = document.getElementById("alert");
const icon = document.getElementById("alert-icon") as HTMLImageElement | null;
const nameEl = document.getElementById("alert-name");
const messageEl = document.getElementById("alert-message");

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
): Promise<void> {
  return playBoundedAudio({
    src,
    volume,
    maxMs,
    sleep,
    createAudio: createBrowserAudio,
    ...(signal ? { signal } : {}),
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
  root.classList.remove("is-out");
  root.classList.add("is-in");
  root.setAttribute("data-visible", "true");
  try {
    await playDonationAlert(donation, volumes, {
      signal,
      sleep,
      playDing: (volume, playSignal) =>
        playHtmlAudio(
          DONATION_ALERT_AUDIO_SRC,
          volume,
          STREAM_ALERT_DING_PLAY_MAX_MS,
          playSignal,
        ),
      waitForSpeechUrl,
      playSpeech: (url, volume, maxMs, playSignal) =>
        playHtmlAudio(url, volume, maxMs, playSignal),
      heartbeat: async (donationId) => {
        await postJson("/stream-alerts/heartbeat", { sessionId, donationId });
      },
    });
  } finally {
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
  };
}

let pumping = false;
let eventsSource: EventSource | null = null;
let eventsReconnectTimer = 0;

async function completeDonation(donationId: string): Promise<void> {
  try {
    await postJson("/stream-alerts/complete", {
      sessionId,
      donationId,
    });
  } catch {
    // Queue recovery via playing lease if complete cannot be delivered.
  }
}

async function pumpQueue(): Promise<void> {
  if (pumping) {
    return;
  }
  pumping = true;
  try {
    for (;;) {
      const claimed = await postJson("/stream-alerts/claim", { sessionId });
      const donation = readClaimedDonation(claimed.donation);
      if (!donation) {
        return;
      }
      await settleDonationPlayback({
        play: (playSignal) => showDonation(donation, playSignal),
        complete: () => completeDonation(donation.id),
        sleep,
      });
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
    void pumpQueue();
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
