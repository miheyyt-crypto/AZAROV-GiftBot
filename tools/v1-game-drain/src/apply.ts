import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { asMap, buildDrainPlan, toDrainReport, walletSum, type DrainReport } from "./audit.js";
import {
  creditUser,
  REFUND_DESCRIPTION,
  TX_MINES_WIN,
  TX_REFUND,
  TX_TOWER_WIN,
} from "./ledger.js";
import type { GamePlan } from "./plan.js";

export type ApplyFlags = {
  apply: boolean;
  confirmDrain: boolean;
  confirmOffline: boolean;
  confirmSourceSha256: string;
  backupPath: string;
  confirmBackupSha256: string;
  pidFile?: string;
};

function userOf(
  store: Record<string, unknown>,
  row: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const users = asMap(store.users);
  const uid = String(row.userId ?? row.telegramUserId ?? "");
  return users[uid];
}

function markFinished(
  row: Record<string, unknown>,
  status: "won" | "cancelled",
  payout: number,
): void {
  row.status = status;
  row.payout = payout;
  row.finishedAt = new Date().toISOString();
}

function settleMines(store: Record<string, unknown>, plan: GamePlan): void {
  const games = asMap(store.minesGames);
  const game = games[plan.id];
  if (!game) {
    throw new Error(`mines ${plan.id} missing`);
  }
  const user = userOf(store, game);
  if (!user) {
    throw new Error(`mines ${plan.id} user missing`);
  }
  if (plan.recommended === "cashout") {
    const amount = plan.cashoutAmount ?? 0;
    const cashoutKey = `mines:cashout:${plan.id}`;
    const winEvent = `mines:game:${plan.id}:win`;
    const grant = creditUser(store, user, amount, TX_MINES_WIN, winEvent, {
      referenceId: plan.id,
      description: "V1 Mines cashout (cutover drain)",
    });
    if (!grant.applied && grant.reason !== "already_granted") {
      throw new Error(`mines cashout failed: ${grant.reason}`);
    }
    markFinished(game, "won", amount);
    const events = asMap(store.events);
    if (!events[cashoutKey]) {
      events[cashoutKey] = {
        eventId: cashoutKey,
        done: true,
        payout: amount,
        requestId: `cutover-drain:${plan.id}`,
        createdAt: game.finishedAt,
      };
      store.events = events;
    }
    return;
  }
  if (plan.recommended === "refund") {
    const eventId = `cutover:game-drain:refund:mines:${plan.id}`;
    const grant = creditUser(store, user, plan.stake, TX_REFUND, eventId, {
      referenceId: plan.id,
      description: REFUND_DESCRIPTION,
    });
    if (!grant.applied && grant.reason !== "already_granted") {
      throw new Error(`mines refund failed: ${grant.reason}`);
    }
    markFinished(game, "cancelled", 0);
  }
}

function settleTower(store: Record<string, unknown>, plan: GamePlan): void {
  const games = asMap(store.towerGames);
  const game = games[plan.id];
  if (!game) {
    throw new Error(`tower ${plan.id} missing`);
  }
  const user = userOf(store, game);
  if (!user) {
    throw new Error(`tower ${plan.id} user missing`);
  }
  if (plan.recommended === "cashout") {
    const amount = plan.cashoutAmount ?? 0;
    const cashoutKey = `tower:cashout:${plan.id}`;
    const winEvent = `tower:game:${plan.id}:win`;
    const grant = creditUser(store, user, amount, TX_TOWER_WIN, winEvent, {
      referenceId: plan.id,
      description: "V1 Tower cashout (cutover drain)",
    });
    if (!grant.applied && grant.reason !== "already_granted") {
      throw new Error(`tower cashout failed: ${grant.reason}`);
    }
    markFinished(game, "won", amount);
    const events = asMap(store.events);
    if (!events[cashoutKey]) {
      events[cashoutKey] = {
        eventId: cashoutKey,
        done: true,
        payout: amount,
        requestId: `cutover-drain:${plan.id}`,
        createdAt: game.finishedAt,
      };
      store.events = events;
    }
    return;
  }
  if (plan.recommended === "refund") {
    const eventId = `cutover:game-drain:refund:tower:${plan.id}`;
    const grant = creditUser(store, user, plan.stake, TX_REFUND, eventId, {
      referenceId: plan.id,
      description: REFUND_DESCRIPTION,
    });
    if (!grant.applied && grant.reason !== "already_granted") {
      throw new Error(`tower refund failed: ${grant.reason}`);
    }
    markFinished(game, "cancelled", 0);
  }
}

function settleRolls(store: Record<string, unknown>, plan: GamePlan): void {
  if (plan.recommended !== "refund") {
    return;
  }
  const rounds = asMap(store.rollRounds);
  const round = rounds[plan.id];
  if (!round) {
    throw new Error(`rolls ${plan.id} missing`);
  }
  const users = asMap(store.users);
  const players = Array.isArray(round.players) ? round.players : [];
  for (const raw of players) {
    const player = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const uid = String(player.userId ?? "");
    const bet = Number(player.bet);
    if (!uid || !Number.isInteger(bet) || bet < 1) {
      continue;
    }
    const user = users[uid];
    if (!user) {
      throw new Error(`rolls ${plan.id} missing user for bet`);
    }
    const eventId = `cutover:game-drain:refund:rolls:${plan.id}:${uid}`;
    const grant = creditUser(store, user, bet, TX_REFUND, eventId, {
      referenceId: `${plan.id}:${uid}`,
      description: REFUND_DESCRIPTION,
    });
    if (!grant.applied && grant.reason !== "already_granted") {
      throw new Error(`rolls refund failed: ${grant.reason}`);
    }
  }
  round.status = "cancelled";
  round.payout = 0;
  round.settledAt = new Date().toISOString();
  round.completedAt = round.settledAt;
}

export function applyPlanToStore(store: Record<string, unknown>): DrainReport {
  const { games } = buildDrainPlan(store);
  if (games.some((g) => g.recommended === "block")) {
    throw new Error("refusing apply: malformed games present");
  }
  for (const plan of games) {
    if (plan.recommended === "skip") {
      continue;
    }
    if (plan.kind === "mines") {
      settleMines(store, plan);
    } else if (plan.kind === "tower") {
      settleTower(store, plan);
    } else {
      settleRolls(store, plan);
    }
  }
  store.cutoverGameDrain = {
    applied: true,
    process: "v1-game-drain",
  };
  return toDrainReport("memory://applied", "", store, "apply");
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertOffline(flags: ApplyFlags): Promise<void> {
  if (!flags.confirmOffline) {
    throw new Error("apply requires --confirm-offline (V1 service must be stopped)");
  }
  if (flags.pidFile) {
    const raw = (await readFile(flags.pidFile, "utf8")).trim();
    const pid = Number(raw);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        throw new Error("refusing apply: pid file process is still running");
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== "ESRCH") {
          throw error;
        }
      }
    }
  }
}

export async function applyDrainFile(
  storePath: string,
  flags: ApplyFlags,
): Promise<{ report: DrainReport; applied: boolean }> {
  if (!flags.apply || !flags.confirmDrain) {
    throw new Error("apply requires --apply and --confirm-drain");
  }
  await assertOffline(flags);
  if (!flags.backupPath || !existsSync(flags.backupPath)) {
    throw new Error("apply requires an existing --backup-path");
  }
  const backupSha = await sha256File(flags.backupPath);
  if (flags.confirmBackupSha256 !== backupSha) {
    throw new Error("backup SHA256 confirmation does not match backup file");
  }
  const bytes = await readFile(storePath);
  const storeSha = createHash("sha256").update(bytes).digest("hex");
  if (flags.confirmSourceSha256 !== storeSha) {
    throw new Error("source SHA256 confirmation does not match store");
  }
  if (storeSha !== backupSha) {
    throw new Error("store SHA256 must equal pre-drain backup SHA256 before apply");
  }
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("store.json root must be an object");
  }
  const store = parsed as Record<string, unknown>;
  const before = toDrainReport(storePath, storeSha, store, "audit");
  if (before.blockingIssues.length > 0) {
    throw new Error("refusing apply: audit blockingIssues is not empty");
  }
  applyPlanToStore(store);
  const afterPlan = buildDrainPlan(store);
  const stillOpen = afterPlan.games.filter(
    (g) => g.recommended === "cashout" || g.recommended === "refund" || g.recommended === "block",
  );
  if (stillOpen.length > 0) {
    throw new Error("apply left unresolved/malformed games");
  }
  const finalSum = walletSum(asMap(store.users));
  if (finalSum !== before.expectedFinalWalletSum) {
    throw new Error(
      `wallet sum mismatch: final ${String(finalSum)} expected ${String(before.expectedFinalWalletSum)}`,
    );
  }
  JSON.stringify(store);
  const tmp = `${storePath}.drain-tmp`;
  await writeFile(tmp, `${JSON.stringify(store)}\n`, "utf8");
  await rename(tmp, storePath);
  await stat(storePath);
  const report = toDrainReport(storePath, await sha256File(storePath), store, "apply");
  report.openingWalletSum = before.openingWalletSum;
  report.expectedFinalWalletSum = finalSum;
  return { report, applied: true };
}
