import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { planMinesGame, planRollsRound, planTowerGame, type GamePlan } from "./plan.js";

export type DrainReport = {
  process: "v1-game-drain";
  mode: "audit" | "apply";
  source: {
    storePath: string;
    sha256: string;
    storeVersion: unknown;
    readAt: string;
  };
  openingWalletSum: number;
  totalUnresolvedStakes: number;
  totalCashouts: number;
  totalRefunds: number;
  expectedFinalWalletSum: number;
  games: GamePlan[];
  financiallyBlocking: number;
  settledPlanned: number;
  malformed: number;
  skipped: number;
  blockingIssues: { code: string; message: string }[];
  warnings: { code: string; message: string }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMap(value: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, row] of Object.entries(value)) {
    if (isRecord(row)) {
      out[key] = row;
    }
  }
  return out;
}

export function walletSum(users: Record<string, Record<string, unknown>>): number {
  let sum = 0;
  for (const user of Object.values(users)) {
    const bal = user.balance;
    if (typeof bal === "number" && Number.isInteger(bal)) {
      sum += bal;
    }
  }
  return sum;
}

export function buildDrainPlan(raw: Record<string, unknown>): {
  games: GamePlan[];
  openingWalletSum: number;
} {
  const games: GamePlan[] = [];
  for (const [id, row] of Object.entries(asMap(raw.minesGames))) {
    games.push(planMinesGame(id, row));
  }
  for (const [id, row] of Object.entries(asMap(raw.towerGames))) {
    games.push(planTowerGame(id, row));
  }
  for (const [id, row] of Object.entries(asMap(raw.rollRounds))) {
    games.push(planRollsRound(id, row));
  }
  return { games, openingWalletSum: walletSum(asMap(raw.users)) };
}

export function toDrainReport(
  storePath: string,
  sha256: string,
  raw: Record<string, unknown>,
  mode: "audit" | "apply",
): DrainReport {
  const { games, openingWalletSum } = buildDrainPlan(raw);
  const actionable = games.filter((g) => g.recommended === "cashout" || g.recommended === "refund");
  const malformed = games.filter((g) => g.recommended === "block");
  const skipped = games.filter((g) => g.recommended === "skip");
  const totalUnresolvedStakes = actionable.reduce((s, g) => s + g.stake, 0);
  const totalCashouts = games
    .filter((g) => g.recommended === "cashout")
    .reduce((s, g) => s + (g.cashoutAmount ?? 0), 0);
  const totalRefunds = games
    .filter((g) => g.recommended === "refund")
    .reduce((s, g) => s + g.stake, 0);
  const blockingIssues = malformed.map((g) => ({
    code: "malformed_game",
    message: `${g.kind} ${g.id}: ${g.reason}`,
  }));
  return {
    process: "v1-game-drain",
    mode,
    source: {
      storePath,
      sha256,
      storeVersion: raw.version,
      readAt: new Date().toISOString(),
    },
    openingWalletSum,
    totalUnresolvedStakes,
    totalCashouts,
    totalRefunds,
    expectedFinalWalletSum: openingWalletSum + totalCashouts + totalRefunds,
    games: games.filter(
      (g) =>
        g.recommended !== "skip" ||
        (g.kind === "rolls" && g.status === "waiting" && g.stake === 0),
    ),
    financiallyBlocking: actionable.length,
    settledPlanned: actionable.length,
    malformed: malformed.length,
    skipped: skipped.length,
    blockingIssues,
    warnings: [],
  };
}

export function reportContainsSecretLeak(json: string): boolean {
  return (
    /accessToken["']?\s*:/i.test(json) ||
    /refreshToken["']?\s*:/i.test(json) ||
    /TELEGRAM_BOT_TOKEN/i.test(json) ||
    /DATABASE_URL/i.test(json)
  );
}

export async function loadStoreFile(storePath: string): Promise<{
  raw: Record<string, unknown>;
  sha256: string;
}> {
  const bytes = await readFile(storePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(parsed)) {
    throw new Error("store.json root must be an object");
  }
  return { raw: parsed, sha256 };
}

export function drainExitCode(report: DrainReport): number {
  return report.blockingIssues.length > 0 ? 2 : 0;
}

export { asMap, isRecord };
