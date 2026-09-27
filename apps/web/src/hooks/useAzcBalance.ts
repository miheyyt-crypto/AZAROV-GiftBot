import { useEffect, useState } from "react";
import { ApiRequestError } from "../api.js";
import { loadSharedProfile, patchCachedProfileBalance } from "../profile/profile-store.js";

let azc = "0";
let lastToken: string | null = null;
let refreshSeq = 0;
let inflight: { token: string; promise: Promise<string | undefined> } | null =
  null;
let visibilityBound = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getAzcBalance(): string {
  return azc;
}

/** Server-authoritative AZC from a mutation or GET /profile. */
export function applyServerBalance(nextAzc: string | null | undefined): void {
  if (typeof nextAzc !== "string" || nextAzc.length === 0) {
    return;
  }
  patchCachedProfileBalance(nextAzc);
  if (azc === nextAzc) {
    return;
  }
  azc = nextAzc;
  emit();
}

export function azcFromMutation(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const row = payload as Record<string, unknown>;
  if (typeof row.newBalanceAzc === "string") {
    return row.newBalanceAzc;
  }
  if (row.balances && typeof row.balances === "object") {
    const balances = row.balances as Record<string, unknown>;
    if (typeof balances.azc === "string") {
      return balances.azc;
    }
  }
  return undefined;
}

export async function refreshBalance(
  token: string,
  options: { force?: boolean } = {},
): Promise<string | undefined> {
  lastToken = token;
  if (inflight && inflight.token === token && !options.force) {
    return inflight.promise;
  }
  const seq = ++refreshSeq;
  const promise = loadSharedProfile(token, { force: options.force === true })
    .then((profile) => {
      if (seq === refreshSeq) {
        applyServerBalance(profile.balances.azc);
      }
      return azc;
    })
    .catch(() => undefined)
    .finally(() => {
      if (inflight?.promise === promise) {
        inflight = null;
      }
    });
  inflight = { token, promise };
  return promise;
}

/** Prefer mutation DTO; otherwise GET /profile. Never guesses a debit. */
export async function syncBalanceFromMutation(
  token: string,
  payload: unknown,
): Promise<void> {
  const fromDto = azcFromMutation(payload);
  if (fromDto !== undefined) {
    applyServerBalance(fromDto);
    return;
  }
  await refreshBalance(token, { force: true });
}

export async function refreshBalanceIfAmbiguous(
  token: string,
  error: unknown,
): Promise<void> {
  if (error instanceof ApiRequestError && error.status < 500) {
    return;
  }
  await refreshBalance(token, { force: true });
}

function bindVisibilityRefetch(): void {
  if (visibilityBound || typeof document === "undefined") {
    return;
  }
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && lastToken) {
      window.setTimeout(() => {
        if (document.visibilityState === "visible" && lastToken) {
          void refreshBalance(lastToken);
        }
      }, 400 + Math.floor(Math.random() * 800));
    }
  });
}

/** Test-only: reset module singleton between cases. */
export function resetAzcBalanceStoreForTests(): void {
  azc = "0";
  lastToken = null;
  refreshSeq += 1;
  inflight = null;
  emit();
}

/** Shared Mini App AZC. All headers should read this value. */
export function useAzcBalance(
  token: string,
  skipRemote = false,
  options: { remoteOnMount?: boolean } = {},
): string {
  const [balanceAzc, setBalanceAzc] = useState(azc);
  const remoteOnMount = options.remoteOnMount === true;

  useEffect(() => {
    const onChange = (): void => {
      setBalanceAzc(azc);
    };
    listeners.add(onChange);
    setBalanceAzc(azc);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  useEffect(() => {
    if (skipRemote) {
      return;
    }
    lastToken = token;
    bindVisibilityRefetch();
    if (remoteOnMount) {
      void refreshBalance(token);
    }
  }, [token, skipRemote, remoteOnMount]);

  return balanceAzc;
}
