export const DONATION_ALERT_ICON_SRC = "/assets/donation-alert-icon.png";
export const DONATION_ALERT_AUDIO_SRC = "/assets/donation-alert.wav";
export const STREAM_DONATION_VISIBLE_MS = 8_000;
export const STREAM_DONATION_FADE_MS = 900;

export function fillAlertTexts(
  nameEl: HTMLElement,
  messageEl: HTMLElement,
  donation: { displayName: string; message: string },
): void {
  nameEl.textContent = donation.displayName;
  messageEl.textContent = donation.message;
}

export function overlaySessionId(storage: Storage): string {
  const key = "giftbot.streamAlertSession";
  const existing = storage.getItem(key);
  if (existing) {
    return existing;
  }
  const created = crypto.randomUUID();
  storage.setItem(key, created);
  return created;
}
