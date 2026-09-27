import { monitorEventLoopDelay } from "node:perf_hooks";
import { inboundEvents } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import type { LoadHarness } from "./harness.js";
import {
  LOADTEST_WEBHOOK_SECRET,
  readLocks,
  readBackends,
  signKickPayload,
  signedInitData,
} from "./harness.js";
import { mapPool, timedRequest, type TimedResponse } from "./http.js";
import { TELEGRAM_ID_BASE } from "./seed.js";
import {
  addStatus,
  readResources,
  summarizeLatency,
  type LatencySummary,
  type LockSnapshot,
  type ResourceSnapshot,
  type StatusCounts,
} from "./stats.js";

export type ScenarioResult = {
  name: string;
  concurrency: number;
  durationMs?: number;
  rps?: number;
  requests: {
    total: number;
    ok: number;
    errors: number;
    statuses: StatusCounts;
  };
  latency: LatencySummary;
  locks: {
    maxWaiting: number;
    end: LockSnapshot;
  };
  resources: ResourceSnapshot;
  dbBackends?: { max: number; end: number };
  eventLoop?: { maxMs: number; meanMs: number };
  notes?: string[];
};

function collect(
  responses: TimedResponse[],
  name: string,
  concurrency: number,
  maxWaiting: number,
  endLocks: LockSnapshot,
  cpuStarted: NodeJS.CpuUsage,
  startedAt: number,
  allowedStatus: Set<number> = new Set(),
  extras: {
    dbBackends?: { max: number; end: number };
    eventLoop?: { maxMs: number; meanMs: number };
  } = {},
): ScenarioResult {
  const statuses: StatusCounts = {};
  const samples: number[] = [];
  let ok = 0;
  let errors = 0;
  for (const response of responses) {
    addStatus(statuses, response.status);
    samples.push(response.ms);
    if (response.ok || allowedStatus.has(response.status)) {
      ok += 1;
    } else {
      errors += 1;
    }
  }
  const durationMs = performance.now() - startedAt;
  return {
    name,
    concurrency,
    durationMs: Math.round(durationMs),
    rps: durationMs > 0 ? Number(((responses.length / durationMs) * 1000).toFixed(2)) : 0,
    requests: {
      total: responses.length,
      ok,
      errors,
      statuses,
    },
    latency: summarizeLatency(samples),
    locks: { maxWaiting, end: endLocks },
    resources: readResources(cpuStarted),
    ...(extras.dbBackends ? { dbBackends: extras.dbBackends } : {}),
    ...(extras.eventLoop ? { eventLoop: extras.eventLoop } : {}),
  };
}

async function watchLocks(
  harness: LoadHarness,
  running: { value: boolean },
): Promise<number> {
  let maxWaiting = 0;
  while (running.value) {
    const snapshot = await readLocks(harness.observeSql);
    maxWaiting = Math.max(maxWaiting, snapshot.waiting);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return maxWaiting;
}

function forwardedFor(
  telegramUserId: number,
  options: { sharedIp?: string } = {},
): string {
  if (options.sharedIp) {
    return options.sharedIp;
  }
  const octet = (telegramUserId % 250) + 1;
  return `198.51.100.${String(octet)}`;
}

async function authToken(
  harness: LoadHarness,
  telegramUserId: number,
  options: { sharedIp?: string } = {},
): Promise<{ auth: TimedResponse; token: string }> {
  const initData = signedInitData(telegramUserId);
  const auth = await timedRequest(`${harness.baseUrl}/auth/telegram`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwardedFor(telegramUserId, options),
    },
    body: JSON.stringify({ initData }),
  });
  let token = "";
  if (auth.ok) {
    try {
      token = (JSON.parse(auth.text) as { token?: string }).token ?? "";
    } catch {
      token = "";
    }
  }
  return { auth, token };
}

async function watchBackends(
  harness: LoadHarness,
  running: { value: boolean },
): Promise<number> {
  let maxBackends = 0;
  while (running.value) {
    const n = await readBackends(harness.observeSql);
    maxBackends = Math.max(maxBackends, n);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return maxBackends;
}

async function homeStartupFlow(
  harness: LoadHarness,
  telegramUserId: number,
  options: { sharedIp?: string } = {},
): Promise<TimedResponse[]> {
  const { auth, token } = await authToken(harness, telegramUserId, options);
  if (!auth.ok || !token) {
    return [auth];
  }
  const headers = {
    authorization: `Bearer ${token}`,
    "x-forwarded-for": forwardedFor(telegramUserId, options),
  };
  const bootstrap = await timedRequest(`${harness.baseUrl}/bootstrap`, {
    method: "GET",
    headers,
  });
  if (!bootstrap.ok) {
    return [auth, bootstrap];
  }
  const parallel = await Promise.all([
    timedRequest(`${harness.baseUrl}/cases/free`, { method: "GET", headers }),
    timedRequest(`${harness.baseUrl}/recent-wins?limit=12`, {
      method: "GET",
      headers,
    }),
    timedRequest(`${harness.baseUrl}/stream-streak`, {
      method: "GET",
      headers,
    }),
    timedRequest(`${harness.baseUrl}/leaderboard/balance`, {
      method: "GET",
      headers,
    }),
    timedRequest(`${harness.baseUrl}/giveaways?tab=active`, {
      method: "GET",
      headers,
    }),
    timedRequest(`${harness.baseUrl}/contest/referral/summary`, {
      method: "GET",
      headers,
    }),
  ]);
  return [auth, bootstrap, ...parallel];
}

/** Realistic Home startup: unique user, auth → bootstrap → Home GETs. */
export async function runHomeStartupLadder(
  harness: LoadHarness,
  concurrency: number,
  telegramIdBase: number,
  options: { innerConcurrency?: number; namePrefix?: string; sharedIp?: string } = {},
): Promise<ScenarioResult> {
  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const lockWatch = watchLocks(harness, running);
  const backendWatch = watchBackends(harness, running);
  const users = Array.from({ length: concurrency }, (_, index) => index);
  const inner = options.innerConcurrency ?? concurrency;
  const responses = (
    await mapPool(users, inner, async (index) =>
      homeStartupFlow(harness, telegramIdBase + index, {
        ...(options.sharedIp ? { sharedIp: options.sharedIp } : {}),
      }),
    )
  ).flat();
  running.value = false;
  const maxWaiting = await lockWatch;
  const maxBackends = await backendWatch;
  histogram.disable();
  const endLocks = await readLocks(harness.observeSql);
  const endBackends = await readBackends(harness.observeSql);
  const prefix = options.namePrefix ?? "home-startup";
  return collect(
    responses,
    `${prefix}-${String(concurrency)}`,
    concurrency,
    maxWaiting,
    endLocks,
    cpuStarted,
    startedAt,
    new Set(),
    {
      dbBackends: { max: maxBackends, end: endBackends },
      eventLoop: {
        maxMs: Math.round(histogram.max / 1e6),
        meanMs: Math.round(histogram.mean / 1e6),
      },
    },
  );
}

export async function runHomeStartupSteady(
  harness: LoadHarness,
  users: number,
  telegramIdBase: number,
): Promise<ScenarioResult> {
  return runHomeStartupLadder(harness, users, telegramIdBase, {
    innerConcurrency: 10,
    namePrefix: "home-steady",
  });
}

/** Legacy Phase-13 ladder (auth+bootstrap+section+live). Kept for smoke compatibility. */
export async function runUserLadder(
  harness: LoadHarness,
  concurrency: number,
  telegramIdBase: number,
): Promise<ScenarioResult> {
  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const lockWatch = watchLocks(harness, running);
  const users = Array.from({ length: concurrency }, (_, index) => index);
  const responses = (
    await mapPool(users, concurrency, async (index) => {
      const telegramUserId = telegramIdBase + index;
      const { auth, token } = await authToken(harness, telegramUserId);
      if (!auth.ok) {
        return [auth];
      }
      const headers = { authorization: `Bearer ${token}` };
      const bootstrap = await timedRequest(`${harness.baseUrl}/bootstrap`, {
        method: "GET",
        headers,
      });
      const section = await timedRequest(`${harness.baseUrl}/sections/home`, {
        method: "GET",
        headers,
      });
      const live = await timedRequest(`${harness.baseUrl}/health/live`, {
        method: "GET",
      });
      return [auth, bootstrap, section, live];
    })
  ).flat();
  running.value = false;
  const maxWaiting = await lockWatch;
  const endLocks = await readLocks(harness.observeSql);
  return collect(
    responses,
    `users-${String(concurrency)}`,
    concurrency,
    maxWaiting,
    endLocks,
    cpuStarted,
    startedAt,
  );
}

export async function runHealthLadder(
  harness: LoadHarness,
  concurrency: number,
): Promise<ScenarioResult> {
  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const lockWatch = watchLocks(harness, running);
  const items = Array.from({ length: concurrency * 4 }, (_, index) => index);
  const responses = await mapPool(items, concurrency, async () =>
    timedRequest(`${harness.baseUrl}/health/live`, { method: "GET" }),
  );
  running.value = false;
  const maxWaiting = await lockWatch;
  const endLocks = await readLocks(harness.observeSql);
  return collect(
    responses,
    `health-${String(concurrency)}`,
    concurrency,
    maxWaiting,
    endLocks,
    cpuStarted,
    startedAt,
  );
}

export async function runAuthedGetLadder(
  harness: LoadHarness,
  name: string,
  path: string,
  concurrency: number,
  telegramIdBase: number,
): Promise<ScenarioResult> {
  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const lockWatch = watchLocks(harness, running);
  const users = Array.from({ length: concurrency }, (_, index) => index);
  const responses = await mapPool(users, concurrency, async (index) => {
    const { auth, token } = await authToken(harness, telegramIdBase + index);
    if (!auth.ok || !token) {
      return auth;
    }
    return timedRequest(`${harness.baseUrl}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
  });
  running.value = false;
  const maxWaiting = await lockWatch;
  const endLocks = await readLocks(harness.observeSql);
  return collect(
    responses,
    name,
    concurrency,
    maxWaiting,
    endLocks,
    cpuStarted,
    startedAt,
  );
}

export async function runWebhookBurst(
  harness: LoadHarness,
  burst: number,
  updateIdBase: number,
): Promise<ScenarioResult> {
  const inboundBefore = (
    await harness.db
      .select({ id: inboundEvents.id })
      .from(inboundEvents)
      .where(eq(inboundEvents.provider, "telegram"))
  ).length;
  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const lockWatch = watchLocks(harness, running);
  const items = Array.from({ length: burst }, (_, index) => index);
  const responses = await mapPool(items, burst, async (index) => {
    const updateId = updateIdBase + index;
    const fromId = 500_000 + index;
    return timedRequest(`${harness.baseUrl}/telegram/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": LOADTEST_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: updateId,
        message: {
          message_id: 1,
          chat: { id: fromId },
          from: { id: fromId, first_name: "Load" },
          text: "hi",
        },
      }),
    });
  });
  running.value = false;
  const maxWaiting = await lockWatch;
  const endLocks = await readLocks(harness.observeSql);
  const inboundAfter = (
    await harness.db
      .select({ id: inboundEvents.id })
      .from(inboundEvents)
      .where(eq(inboundEvents.provider, "telegram"))
  ).length;
  const result = collect(
    responses,
    `webhook-burst-${String(burst)}`,
    burst,
    maxWaiting,
    endLocks,
    cpuStarted,
    startedAt,
  );
  if (inboundAfter - inboundBefore !== burst) {
    result.requests.errors += 1;
    result.requests.statuses.missing_inbound =
      (result.requests.statuses.missing_inbound ?? 0) + 1;
  }
  return result;
}

export async function runKickWebhookBurst(
  harness: LoadHarness,
  burst: number,
  messageIdBase: string,
): Promise<ScenarioResult> {
  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const lockWatch = watchLocks(harness, running);
  const items = Array.from({ length: burst }, (_, index) => index);
  const timestamp = new Date().toISOString();
  const responses = await mapPool(items, Math.min(burst, 200), async (index) => {
    const messageId = `${messageIdBase}${String(index).padStart(8, "0")}`;
    const rawBody = JSON.stringify({
      message_id: messageId,
      content: "load",
      sender: { user_id: 1 },
    });
    const signature = signKickPayload(
      harness.kickPrivateKeyPem,
      messageId,
      timestamp,
      rawBody,
    );
    return timedRequest(`${harness.baseUrl}/kick/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "kick-event-message-id": messageId,
        "kick-event-message-timestamp": timestamp,
        "kick-event-signature": signature,
        "kick-event-type": "chat.message.sent",
      },
      body: rawBody,
    });
  });
  running.value = false;
  const maxWaiting = await lockWatch;
  const endLocks = await readLocks(harness.observeSql);
  return collect(
    responses,
    `kick-webhook-burst-${String(burst)}`,
    burst,
    maxWaiting,
    endLocks,
    cpuStarted,
    startedAt,
  );
}

export async function runDiceBurst(
  harness: LoadHarness,
  concurrency: number,
  telegramIdBase: number,
): Promise<ScenarioResult> {
  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const lockWatch = watchLocks(harness, running);
  const users = Array.from({ length: concurrency }, (_, index) => index);
  const responses = await mapPool(users, concurrency, async (index) => {
    const { auth, token } = await authToken(harness, telegramIdBase + index);
    if (!auth.ok || !token) {
      return auth;
    }
    return timedRequest(`${harness.baseUrl}/games/dice/play`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": `load-dice-${String(telegramIdBase + index)}-${String(Date.now())}`,
      },
      body: JSON.stringify({
        betAzc: "100",
        chance: 50,
        clientSeed: `c${String(index)}`,
      }),
    });
  });
  running.value = false;
  const maxWaiting = await lockWatch;
  const endLocks = await readLocks(harness.observeSql);
  return collect(
    responses,
    `dice-${String(concurrency)}`,
    concurrency,
    maxWaiting,
    endLocks,
    cpuStarted,
    startedAt,
    new Set([409]),
  );
}

export async function runRollsJoinBurst(
  harness: LoadHarness,
  players: number,
  telegramIdBase: number = TELEGRAM_ID_BASE,
): Promise<ScenarioResult> {
  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const lockWatch = watchLocks(harness, running);
  const batch = Math.min(players, 40);
  const users = Array.from({ length: players }, (_, index) => index);
  const responses = await mapPool(users, batch, async (index) => {
    const { auth, token } = await authToken(harness, telegramIdBase + index);
    if (!auth.ok || !token) {
      return auth;
    }
    return timedRequest(`${harness.baseUrl}/games/rolls/bet`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": `load-rolls-${String(players)}-${String(index)}`,
      },
      body: JSON.stringify({
        amountAzc: "100",
        clientSeed: `r${String(index)}`,
      }),
    });
  });
  running.value = false;
  const maxWaiting = await lockWatch;
  const endLocks = await readLocks(harness.observeSql);
  const result = collect(
    responses,
    `rolls-join-${String(players)}`,
    players,
    maxWaiting,
    endLocks,
    cpuStarted,
    startedAt,
    new Set([409]),
  );
  return result;
}

export async function runRollsWsClients(
  harness: LoadHarness,
  clients: number,
  telegramIdBase: number,
): Promise<ScenarioResult> {
  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const lockWatch = watchLocks(harness, running);
  const samples: number[] = [];
  const statuses: StatusCounts = {};
  let ok = 0;
  let errors = 0;
  const sockets: WebSocket[] = [];
  const batch = Math.min(clients, 50);
  const indexes = Array.from({ length: clients }, (_, i) => i);

  await mapPool(indexes, batch, async (index) => {
    const t0 = performance.now();
    try {
      const { auth, token } = await authToken(harness, telegramIdBase + index);
      if (!auth.ok || !token) {
        addStatus(statuses, auth.status || 0);
        errors += 1;
        samples.push(performance.now() - t0);
        return;
      }
      const url = `${harness.baseUrl.replace("http", "ws")}/games/rolls/ws?token=${encodeURIComponent(token)}`;
      await new Promise<void>((resolve) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          addStatus(statuses, 0);
          errors += 1;
          samples.push(performance.now() - t0);
          resolve();
        }, 8_000);
        ws.addEventListener("open", () => {
          sockets.push(ws);
        });
        ws.addEventListener("message", () => {
          clearTimeout(timer);
          addStatus(statuses, 101);
          ok += 1;
          samples.push(performance.now() - t0);
          resolve();
        });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          addStatus(statuses, 0);
          errors += 1;
          samples.push(performance.now() - t0);
          resolve();
        });
      });
    } catch {
      addStatus(statuses, 0);
      errors += 1;
      samples.push(performance.now() - t0);
    }
  });

  // Hold briefly then disconnect (memory leak / cleanup check).
  await new Promise((r) => setTimeout(r, 500));
  for (const ws of sockets) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  running.value = false;
  const maxWaiting = await lockWatch;
  const endLocks = await readLocks(harness.observeSql);
  const durationMs = performance.now() - startedAt;
  return {
    name: `rolls-ws-${String(clients)}`,
    concurrency: clients,
    durationMs: Math.round(durationMs),
    rps:
      durationMs > 0
        ? Number(((clients / durationMs) * 1000).toFixed(2))
        : 0,
    requests: { total: clients, ok, errors, statuses },
    latency: summarizeLatency(samples),
    locks: { maxWaiting, end: endLocks },
    resources: readResources(cpuStarted),
    notes: [`open_sockets_peak=${String(sockets.length)}`],
  };
}

/** Weighted mixed read/write for a short window (not 15m unless durationMs set high). */
export async function runMixedLoad(
  harness: LoadHarness,
  concurrency: number,
  durationMs: number,
  telegramIdBase: number,
): Promise<ScenarioResult> {
  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const lockWatch = watchLocks(harness, running);
  const responses: TimedResponse[] = [];
  const deadline = startedAt + durationMs;
  const workers = Array.from({ length: concurrency }, (_, index) => index);

  await mapPool(workers, concurrency, async (index) => {
    const { auth, token } = await authToken(harness, telegramIdBase + index);
    if (!auth.ok || !token) {
      responses.push(auth);
      return;
    }
    const headers = { authorization: `Bearer ${token}` };
    let n = 0;
    while (performance.now() < deadline) {
      const roll = n % 10;
      n += 1;
      if (roll < 4) {
        responses.push(
          await timedRequest(`${harness.baseUrl}/bootstrap`, {
            method: "GET",
            headers,
          }),
        );
        responses.push(
          await timedRequest(`${harness.baseUrl}/leaderboard/balance`, {
            method: "GET",
            headers,
          }),
        );
      } else if (roll < 6) {
        responses.push(
          await timedRequest(`${harness.baseUrl}/profile`, {
            method: "GET",
            headers,
          }),
        );
      } else if (roll < 8) {
        responses.push(
          await timedRequest(`${harness.baseUrl}/games/dice/play`, {
            method: "POST",
            headers: {
              ...headers,
              "content-type": "application/json",
              "idempotency-key": `mix-dice-${String(index)}-${String(n)}`,
            },
            body: JSON.stringify({
              betAzc: "100",
              chance: 50,
              clientSeed: `m${String(index)}-${String(n)}`,
            }),
          }),
        );
      } else if (roll < 9) {
        responses.push(
          await timedRequest(`${harness.baseUrl}/recent-wins?limit=12`, {
            method: "GET",
            headers,
          }),
        );
      } else {
        responses.push(
          await timedRequest(`${harness.baseUrl}/telegram/webhook`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-telegram-bot-api-secret-token": LOADTEST_WEBHOOK_SECRET,
            },
            body: JSON.stringify({
              update_id: 9_000_000 + index * 10_000 + n,
              message: {
                message_id: n,
                chat: { id: 700_000 + index },
                from: { id: 700_000 + index, first_name: "Mix" },
                text: "hi",
              },
            }),
          }),
        );
      }
    }
  });

  running.value = false;
  const maxWaiting = await lockWatch;
  const endLocks = await readLocks(harness.observeSql);
  return collect(
    responses,
    `mixed-${String(concurrency)}-${String(durationMs)}ms`,
    concurrency,
    maxWaiting,
    endLocks,
    cpuStarted,
    startedAt,
    new Set([409]),
  );
}

export async function runPromoFinalSlotRace(
  harness: LoadHarness,
  attempts: number,
  telegramIdBase: number,
): Promise<ScenarioResult & { successCount?: number }> {
  const { createPromoCode, provisionUser } = await import("@giftbot/domain");
  const admin = await provisionUser(harness.db, { displayName: "PromoAdmin" });
  const code = `LOADLAST${String(Date.now()).slice(-6)}`;
  await createPromoCode(harness.db, {
    code,
    rewardAzc: "500",
    activationLimit: 1,
    adminUserId: admin.userId,
    idempotencyKey: `load-promo-create-${code}`,
  });

  const cpuStarted = process.cpuUsage();
  const startedAt = performance.now();
  const running = { value: true };
  const lockWatch = watchLocks(harness, running);
  const users = Array.from({ length: attempts }, (_, index) => index);
  const responses = await mapPool(users, attempts, async (index) => {
    const { auth, token } = await authToken(harness, telegramIdBase + index);
    if (!auth.ok || !token) {
      return auth;
    }
    return timedRequest(`${harness.baseUrl}/promo/redeem`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": `promo-race-${code}-${String(index)}`,
      },
      body: JSON.stringify({ code }),
    });
  });
  running.value = false;
  const maxWaiting = await lockWatch;
  const endLocks = await readLocks(harness.observeSql);
  const result = collect(
    responses,
    `promo-final-slot-${String(attempts)}`,
    attempts,
    maxWaiting,
    endLocks,
    cpuStarted,
    startedAt,
    new Set([409, 404, 400]),
  );
  const successCount = responses.filter((r) => r.status === 200).length;
  result.notes = [`promo_success_count=${String(successCount)} (expect 1)`];
  if (successCount !== 1) {
    result.requests.errors += 1;
    result.requests.statuses.promo_success_mismatch =
      (result.requests.statuses.promo_success_mismatch ?? 0) + 1;
  }
  return result;
}
