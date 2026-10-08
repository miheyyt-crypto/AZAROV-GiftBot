import type { SessionCache } from "./types.js";

export const SESSION_STORAGE_KEY = "giftbot.miniAppSession";
export const DEV_ADMIN_TOKEN_KEY = "giftbot.devAdminToken";
export const ADMIN_SESSION_KEY = "giftbot.adminSession";

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function readSession(store: KeyValueStore): SessionCache | undefined {
  const raw = store.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as SessionCache;
    if (typeof parsed.token === "string" && typeof parsed.expiresAt === "string") {
      return parsed;
    }
  } catch {
    store.removeItem(SESSION_STORAGE_KEY);
  }
  return undefined;
}

export function writeSession(store: KeyValueStore, session: SessionCache): void {
  store.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(store: KeyValueStore): void {
  store.removeItem(SESSION_STORAGE_KEY);
}

export function readDevAdminToken(store: KeyValueStore): string | undefined {
  const token = store.getItem(DEV_ADMIN_TOKEN_KEY);
  return token && token.length > 0 ? token : undefined;
}

export function writeDevAdminToken(store: KeyValueStore, token: string): void {
  store.setItem(DEV_ADMIN_TOKEN_KEY, token);
}

export function clearDevAdminToken(store: KeyValueStore): void {
  store.removeItem(DEV_ADMIN_TOKEN_KEY);
}

export function readAdminSession(
  store: KeyValueStore,
): SessionCache | undefined {
  const raw = store.getItem(ADMIN_SESSION_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as SessionCache;
    if (typeof parsed.token === "string" && typeof parsed.expiresAt === "string") {
      return parsed;
    }
  } catch {
    store.removeItem(ADMIN_SESSION_KEY);
  }
  return undefined;
}

export function writeAdminSession(store: KeyValueStore, session: SessionCache): void {
  store.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

export function clearAdminSession(store: KeyValueStore): void {
  store.removeItem(ADMIN_SESSION_KEY);
}
