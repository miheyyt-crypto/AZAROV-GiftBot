import { DONATION_ALERT_AUDIO_SRC } from "./overlay-dom.js";
import {
  STREAM_ALERT_DING_GAP_MS,
  STREAM_ALERT_DING_PLAY_MAX_MS,
  STREAM_ALERT_SPEECH_START_MAX_MS,
  STREAM_ALERT_TTS_PLAY_MAX_MS,
  createBrowserAudio,
  playBoundedAudio,
  playDonationAlert,
  type OverlayAudioHandle,
} from "./overlay-player.js";

const SPEECH_SRC = "/assets/ru_roman-bench.wav";
const logEl = document.getElementById("log");
const root = document.getElementById("alert");
const nameEl = document.getElementById("alert-name");
const messageEl = document.getElementById("alert-message");

function log(line: string): void {
  if (logEl) {
    logEl.textContent = `${logEl.textContent ?? ""}\n${line}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

type Row = {
  label: string;
  waitBeforeCardMs: number;
  cardToPlayingMs: number | null;
  mode: string;
};

async function runOnce(label: string, speechUrl: string): Promise<Row> {
  const preparedDing: { current: OverlayAudioHandle | null } = { current: null };
  const preparedSpeech: { current: OverlayAudioHandle | null } = { current: null };
  let waitBeforeCardMs = 0;
  let shownAt = 0;
  let playingAt: number | null = null;
  const waitStarted = performance.now();
  if (nameEl) {
    nameEl.textContent = "FormNick";
  }
  if (messageEl) {
    messageEl.textContent = "только текст сообщения";
  }
  const mode = await playDonationAlert(
    { id: label, displayName: "FormNick", message: "только текст сообщения", ttsStatus: "ready" },
    { ding: 0.01, speech: 0.01 },
    {
      sleep,
      onShowCard: () => {
        shownAt = performance.now();
        waitBeforeCardMs = shownAt - waitStarted;
        root?.setAttribute("data-visible", "true");
      },
      prepareDing: async (timeoutMs, signal) => {
        const audio = createBrowserAudio(DONATION_ALERT_AUDIO_SRC);
        preparedDing.current = audio;
        return Boolean(await audio.waitReady?.(timeoutMs, sleep, signal));
      },
      playDing: (volume, signal) => {
        const audio = preparedDing.current;
        preparedDing.current = null;
        if (!audio) {
          return Promise.resolve();
        }
        return playBoundedAudio({
          src: DONATION_ALERT_AUDIO_SRC,
          volume,
          maxMs: STREAM_ALERT_DING_PLAY_MAX_MS,
          sleep,
          createAudio: () => audio,
          audio,
          ...(signal ? { signal } : {}),
        });
      },
      waitForSpeechUrl: async () => speechUrl,
      prepareSpeech: async (url, timeoutMs, signal) => {
        const extraDelay = Number(
          new URLSearchParams(window.location.search).get("delay") ?? "0",
        );
        if (extraDelay > 0) {
          await sleep(extraDelay);
        }
        const audio = createBrowserAudio(url);
        preparedSpeech.current = audio;
        const ready = await audio.waitReady?.(timeoutMs, sleep, signal);
        if (!ready) {
          audio.stop();
          preparedSpeech.current = null;
          return false;
        }
        return true;
      },
      playSpeech: async (url, volume, maxMs, signal, playingDeadlineMs) => {
        const audio = preparedSpeech.current;
        preparedSpeech.current = null;
        if (!audio) {
          return;
        }
        const deadline = playingDeadlineMs ?? STREAM_ALERT_SPEECH_START_MAX_MS;
        const wrapped: OverlayAudioHandle = {
          ...audio,
          waitPlaying: async (timeoutMs, waitSleep, playSignal) => {
            const started = await audio.waitPlaying?.(timeoutMs, waitSleep, playSignal);
            if (started) {
              playingAt = performance.now();
            }
            return Boolean(started);
          },
        };
        await playBoundedAudio({
          src: url,
          volume,
          maxMs,
          sleep,
          createAudio: () => wrapped,
          audio: wrapped,
          playingDeadlineMs: deadline,
          ...(signal ? { signal } : {}),
        });
      },
      heartbeat: async () => undefined,
      ttsEnabled: true,
    },
  );
  preparedDing.current?.stop();
  preparedSpeech.current?.stop();
  root?.removeAttribute("data-visible");
  const cardToPlayingMs = playingAt === null ? null : playingAt - shownAt;
  log(
    JSON.stringify({
      label,
      waitBeforeCardMs: Math.round(waitBeforeCardMs),
      cardToPlayingMs: cardToPlayingMs === null ? null : Math.round(cardToPlayingMs),
      mode,
      speechStartMaxMs: STREAM_ALERT_SPEECH_START_MAX_MS,
      dingGapMs: STREAM_ALERT_DING_GAP_MS,
      ttsPlayMaxMs: STREAM_ALERT_TTS_PLAY_MAX_MS,
    }),
  );
  return { label, waitBeforeCardMs, cardToPlayingMs, mode };
}

void (async () => {
  const params = new URLSearchParams(window.location.search);
  const speechUrl = params.get("speech") ?? SPEECH_SRC;
  const rows: Row[] = [];
  rows.push(await runOnce("cold-first", speechUrl));
  rows.push(await runOnce("warm-2", speechUrl));
  rows.push(await runOnce("warm-3", speechUrl));
  const delays = rows
    .map((row) => row.cardToPlayingMs)
    .filter((ms): ms is number => ms !== null);
  const maxDelay = delays.length > 0 ? Math.max(...delays) : null;
  log(JSON.stringify({ kind: "summary", maxCardToPlayingMs: maxDelay, rows }));
  log("BENCH_OK");
})();
