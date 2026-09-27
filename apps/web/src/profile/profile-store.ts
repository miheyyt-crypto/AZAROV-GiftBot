import { loadJson } from "../api.js";
import { invalidateGetDedup } from "../get-dedup.js";
import type { BootstrapPayload } from "../types.js";
import { profileSummaryFromBootstrap } from "./from-bootstrap.js";
import { parseProfileSummary } from "./parse.js";
import { EMPTY_PROFILE_SUMMARY, type ProfileSummary } from "./types.js";

let cached:
  | { token: string; summary: ProfileSummary; at: number }
  | null = null;
let inflight: { token: string; promise: Promise<ProfileSummary> } | null = null;
const FRESH_MS = 30_000;

export function seedProfileFromBootstrap(
  token: string,
  bootstrap: BootstrapPayload,
): ProfileSummary {
  const summary = profileSummaryFromBootstrap(bootstrap);
  cached = { token, summary, at: Date.now() };
  return summary;
}

export function readCachedProfile(token: string): ProfileSummary | undefined {
  if (cached && cached.token === token) {
    return cached.summary;
  }
  return undefined;
}

/** Keep cached identity; update AZC after a mutation DTO. */
export function patchCachedProfileBalance(azc: string): void {
  if (!cached) {
    return;
  }
  cached = {
    ...cached,
    summary: {
      ...cached.summary,
      balances: { ...cached.summary.balances, azc },
    },
  };
}

export function resetProfileStoreForTests(): void {
  cached = null;
  inflight = null;
}

export async function loadSharedProfile(
  token: string,
  options: { force?: boolean } = {},
): Promise<ProfileSummary> {
  if (
    !options.force &&
    cached &&
    cached.token === token &&
    Date.now() - cached.at < FRESH_MS
  ) {
    return cached.summary;
  }
  if (inflight && inflight.token === token) {
    return inflight.promise;
  }
  const promise = loadJson(token, "/profile", parseProfileSummary)
    .then((summary) => {
      cached = { token, summary, at: Date.now() };
      return summary;
    })
    .finally(() => {
      if (inflight?.promise === promise) {
        inflight = null;
      }
    });
  inflight = { token, promise };
  return promise;
}

export function invalidateSharedProfile(token: string): void {
  if (cached?.token === token) {
    cached = null;
  }
  invalidateGetDedup(token, "/profile");
}

export function profileOrEmpty(token: string): ProfileSummary {
  return readCachedProfile(token) ?? EMPTY_PROFILE_SUMMARY;
}
