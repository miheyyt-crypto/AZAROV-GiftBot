import {
  DONATION_ALERT_AUDIO_SRC,
  DONATION_ALERT_ICON_SRC,
  STREAM_DONATION_FADE_MS,
  STREAM_DONATION_VISIBLE_MS,
  fillAlertTexts,
  overlaySessionId,
} from "./overlay-dom.js";
import "./overlay.css";

type OverlayDonation = {
  id: string;
  displayName: string;
  message: string;
};

const token = new URLSearchParams(window.location.search).get("token") ?? "";
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

function playAlertSound(): void {
  const audio = new Audio(DONATION_ALERT_AUDIO_SRC);
  audio.volume = 1;
  void audio.play().catch(() => undefined);
}

async function showDonation(donation: OverlayDonation): Promise<void> {
  if (!root || !nameEl || !messageEl) {
    return;
  }
  fillAlertTexts(nameEl, messageEl, donation);
  root.classList.remove("is-out");
  root.classList.add("is-in");
  root.setAttribute("data-visible", "true");
  playAlertSound();
  await sleep(STREAM_DONATION_VISIBLE_MS);
  root.classList.remove("is-in");
  root.classList.add("is-out");
  await sleep(STREAM_DONATION_FADE_MS);
  root.classList.remove("is-out");
  root.removeAttribute("data-visible");
  nameEl.textContent = "";
  messageEl.textContent = "";
}

let pumping = false;
let eventsSource: EventSource | null = null;
let eventsReconnectTimer = 0;

async function pumpQueue(): Promise<void> {
  if (pumping) {
    return;
  }
  pumping = true;
  try {
    for (;;) {
      const claimed = await postJson("/stream-alerts/claim", { sessionId });
      const donation = claimed.donation;
      if (!donation || typeof donation !== "object") {
        return;
      }
      const row = donation as Record<string, unknown>;
      if (typeof row.id !== "string") {
        return;
      }
      await showDonation({
        id: row.id,
        displayName: typeof row.displayName === "string" ? row.displayName : "",
        message: typeof row.message === "string" ? row.message : "",
      });
      await postJson("/stream-alerts/complete", {
        sessionId,
        donationId: row.id,
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
