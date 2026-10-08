export type StreamAlertHubEvent =
  | { type: "queued" }
  | { type: "dismissed"; donationId: string };

type Listener = (event: StreamAlertHubEvent) => void;

const listeners = new Set<Listener>();

export function subscribeStreamAlerts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyStreamAlertsQueued(): void {
  for (const listener of listeners) {
    listener({ type: "queued" });
  }
}

export function notifyStreamAlertsDismissed(donationId: string): void {
  for (const listener of listeners) {
    listener({ type: "dismissed", donationId });
  }
}
