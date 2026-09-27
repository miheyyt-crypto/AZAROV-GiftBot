import {
  loadBootstrap,
  authenticateTelegram,
  authenticateDev,
  ApiRequestError,
} from "./api.js";
import type { DevLocalRole } from "./dev-role.js";
import {
  clearDevAdminToken,
  clearSession,
  readSession,
  writeDevAdminToken,
  writeSession,
  type KeyValueStore,
} from "./session.js";
import { assertStartupBudget, planStartup, sessionIsUsable } from "./startup.js";
import type { BootstrapPayload, SessionCache } from "./types.js";

export type { DevLocalRole } from "./dev-role.js";
export { readDevRoleFromSearch } from "./dev-role.js";

export type BootResult =
  | {
      status: "ready";
      bootstrap: BootstrapPayload;
      token: string;
      devRole?: DevLocalRole;
    }
  | { status: "needs_telegram" }
  | { status: "error"; message: string; keepSession?: boolean };

/** Coalesce concurrent boots (React StrictMode) so session rotation runs once. */
let inflightBoot: { key: string; promise: Promise<BootResult> } | null = null;
let lastReady: { token: string; bootstrap: BootstrapPayload } | null = null;

/** Test-only reset for in-flight coalescing. */
export function resetBootInflightForTests(): void {
  inflightBoot = null;
  lastReady = null;
}

function bootKey(
  options: { devRole?: DevLocalRole },
  hasInitData: boolean,
): string {
  if (options.devRole) {
    return `dev:${options.devRole}`;
  }
  return hasInitData ? "telegram" : "anon";
}

async function bootMiniAppOnce(
  store: KeyValueStore,
  readInitData: () => string | undefined,
  options: { devRole?: DevLocalRole },
): Promise<BootResult> {
  if (options.devRole) {
    try {
      const auth = await authenticateDev(options.devRole);
      const session: SessionCache = {
        token: auth.token,
        expiresAt: auth.expiresAt,
      };
      writeSession(store, session);
      if (auth.adminToken) {
        writeDevAdminToken(store, auth.adminToken);
      } else {
        clearDevAdminToken(store);
      }
      const bootstrap = await loadBootstrap(auth.token);
      lastReady = { token: auth.token, bootstrap };
      return {
        status: "ready",
        bootstrap,
        token: auth.token,
        ...(options.devRole ? { devRole: options.devRole } : {}),
      };
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        return {
          status: "error",
          message:
            "Local dev auth is disabled on the API (need NODE_ENV≠production and ALLOW_DEV_AUTH=true).",
        };
      }
      if (error instanceof ApiRequestError && error.status === 0) {
        return {
          status: "error",
          message:
            "Cannot reach the local API. Start the stack with: pnpm dev:local",
        };
      }
      return {
        status: "error",
        message: "Could not sign in with local dev auth.",
      };
    }
  }

  const cached = readSession(store);
  const hasSession = sessionIsUsable(cached);
  const plan = planStartup(hasSession);
  assertStartupBudget(plan);

  if (hasSession && cached) {
    try {
      const bootstrap = await loadBootstrap(cached.token);
      lastReady = { token: cached.token, bootstrap };
      return { status: "ready", bootstrap, token: cached.token };
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        clearSession(store);
        clearDevAdminToken(store);
        lastReady = null;
      } else if (lastReady && lastReady.token === cached.token) {
        return {
          status: "ready",
          bootstrap: lastReady.bootstrap,
          token: cached.token,
        };
      } else {
        return {
          status: "error",
          message: "Could not load your profile.",
          keepSession: true,
        };
      }
    }
  }

  const initData = readInitData();
  if (!initData) {
    return { status: "needs_telegram" };
  }

  try {
    const auth = await authenticateTelegram(initData);
    const session: SessionCache = { token: auth.token, expiresAt: auth.expiresAt };
    writeSession(store, session);
    clearDevAdminToken(store);
    const bootstrap = await loadBootstrap(auth.token);
    lastReady = { token: auth.token, bootstrap };
    return { status: "ready", bootstrap, token: auth.token };
  } catch {
    return { status: "error", message: "Could not sign in." };
  }
}

export async function bootMiniApp(
  store: KeyValueStore,
  readInitData: () => string | undefined,
  options: { devRole?: DevLocalRole } = {},
): Promise<BootResult> {
  const key = bootKey(options, Boolean(readInitData()));
  if (inflightBoot && inflightBoot.key === key) {
    return inflightBoot.promise;
  }
  const promise = bootMiniAppOnce(store, readInitData, options).finally(() => {
    if (inflightBoot?.promise === promise) {
      inflightBoot = null;
    }
  });
  inflightBoot = { key, promise };
  return promise;
}
