import { authenticateAdmin } from "../api.js";
import {
  readAdminSession,
  readDevAdminToken,
  writeAdminSession,
  type KeyValueStore,
} from "../session.js";
import { readTelegramInitData } from "../telegram.js";

const ADMIN_SESSION_SKEW_MS = 5_000;
const inFlightByStore = new WeakMap<KeyValueStore, Promise<string>>();

export async function resolveAdminBearer(deps?: {
  store?: KeyValueStore;
  nowMs?: number;
  authenticate?: typeof authenticateAdmin;
  initData?: string | null;
}): Promise<string> {
  const store = deps?.store ?? window.sessionStorage;
  const nowMs = deps?.nowMs ?? Date.now();
  const cachedDev = readDevAdminToken(store);
  if (cachedDev) {
    return cachedDev;
  }
  const cached = readAdminSession(store);
  if (cached && Date.parse(cached.expiresAt) > nowMs + ADMIN_SESSION_SKEW_MS) {
    return cached.token;
  }
  const pending = inFlightByStore.get(store);
  if (pending) {
    return pending;
  }
  const initData =
    deps && "initData" in deps ? deps.initData : readTelegramInitData();
  if (!initData) {
    if (import.meta.env.DEV) {
      throw new Error(
        "Local admin needs ?dev=admin (or Telegram initData). User mode has no admin token.",
      );
    }
    throw new Error("telegram_required");
  }
  const authenticate = deps?.authenticate ?? authenticateAdmin;
  const started = (async () => {
    try {
      const auth = await authenticate(initData);
      writeAdminSession(store, { token: auth.token, expiresAt: auth.expiresAt });
      return auth.token;
    } finally {
      inFlightByStore.delete(store);
    }
  })();
  inFlightByStore.set(store, started);
  return started;
}
