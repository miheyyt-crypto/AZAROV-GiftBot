import type { ProfileSummary } from "./types.js";

export const PROFILE_LIVE_REFRESH_MS = 10_000;

export type ProfileViewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ProfileSummary };

export function applyProfileRefreshOutcome(
  current: ProfileViewState,
  outcome:
    | { ok: true; data: ProfileSummary }
    | { ok: false; message: string },
): ProfileViewState {
  if (outcome.ok) {
    return { status: "ready", data: outcome.data };
  }
  if (current.status === "ready") {
    return current;
  }
  return { status: "error", message: outcome.message };
}

export function scheduleProfileLiveRefresh(input: {
  skipRemote: boolean;
  isVisible: () => boolean;
  onRefresh: () => void;
  addVisibilityListener: (listener: () => void) => () => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): () => void {
  if (input.skipRemote) {
    return () => undefined;
  }
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  input.onRefresh();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (timer !== undefined) {
      clearIntervalFn(timer);
      timer = undefined;
    }
  };
  const start = (): void => {
    if (timer !== undefined) {
      return;
    }
    timer = setIntervalFn(() => {
      if (input.isVisible()) {
        input.onRefresh();
      }
    }, PROFILE_LIVE_REFRESH_MS);
  };
  if (input.isVisible()) {
    start();
  }
  const remove = input.addVisibilityListener(() => {
    if (input.isVisible()) {
      input.onRefresh();
      start();
    } else {
      stop();
    }
  });
  return () => {
    stop();
    remove();
  };
}
