type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeStreamAlerts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyStreamAlertsQueued(): void {
  for (const listener of listeners) {
    listener();
  }
}
