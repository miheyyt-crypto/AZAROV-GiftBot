import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type V1Store = {
  raw: Record<string, unknown>;
  sha256: string;
  version: unknown;
  users: Record<string, Record<string, unknown>>;
  referrals: Record<string, Record<string, unknown>>;
  orders: Record<string, Record<string, unknown>>;
  inventory: Record<string, Record<string, unknown>>;
  caseOpenings: Record<string, Record<string, unknown>>;
  promoCodes: Record<string, Record<string, unknown>>;
  promoUsages: Record<string, Record<string, unknown>>;
  notifications: Record<string, Record<string, unknown>>;
  partnerSubmissions: Record<string, Record<string, unknown>>;
  partnerAccountBinds: Record<string, Record<string, unknown>>;
  kickAccounts: Record<string, Record<string, unknown>>;
  kickStreamStreaks: Record<string, Record<string, unknown>>;
  kickWatchStats: Record<string, Record<string, unknown>>;
  withdrawals: Record<string, Record<string, unknown>>;
  giveaways: Record<string, Record<string, unknown>>;
  giveawayParticipants: Record<string, Record<string, unknown>>;
  minesGames: Record<string, Record<string, unknown>>;
  towerGames: Record<string, Record<string, unknown>>;
  rollRounds: Record<string, Record<string, unknown>>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asMap(value: unknown): Record<string, Record<string, unknown>> {
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

export function telegramIdOf(user: Record<string, unknown>): bigint | undefined {
  const raw = user.telegramId ?? user.telegram_id ?? user.id;
  if (typeof raw === "bigint") {
    return raw;
  }
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return BigInt(raw);
  }
  if (typeof raw === "string" && /^-?\d+$/.test(raw)) {
    return BigInt(raw);
  }
  return undefined;
}

export function parseIso(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return undefined;
  }
  return d;
}

export function asNonNegInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

export function asAzc(value: unknown): bigint | undefined {
  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return undefined;
}

export function storeFromObject(raw: Record<string, unknown>, sha256?: string): V1Store {
  const bytes = Buffer.from(JSON.stringify(raw), "utf8");
  const hash = sha256 ?? createHash("sha256").update(bytes).digest("hex");
  const usersRaw = raw.users;
  const users: Record<string, Record<string, unknown>> = {};
  if (Array.isArray(usersRaw)) {
    for (const row of usersRaw) {
      if (isRecord(row)) {
        const id = telegramIdOf(row);
        if (id !== undefined) {
          users[id.toString()] = row;
        }
      }
    }
  } else {
    Object.assign(users, asMap(usersRaw));
  }
  return {
    raw,
    sha256: hash,
    version: raw.version,
    users,
    referrals: asMap(raw.referrals),
    orders: asMap(raw.orders),
    inventory: asMap(raw.inventory),
    caseOpenings: asMap(raw.caseOpenings),
    promoCodes: asMap(raw.promoCodes),
    promoUsages: asMap(raw.promoUsages),
    notifications: asMap(raw.notifications),
    partnerSubmissions: asMap(raw.partnerSubmissions),
    partnerAccountBinds: asMap(raw.partnerAccountBinds),
    kickAccounts: asMap(raw.kickAccounts),
    kickStreamStreaks: asMap(raw.kickStreamStreaks),
    kickWatchStats: asMap(raw.kickWatchStats),
    withdrawals: asMap(raw.withdrawals),
    giveaways: asMap(raw.giveaways),
    giveawayParticipants: asMap(raw.giveawayParticipants),
    minesGames: asMap(raw.minesGames),
    towerGames: asMap(raw.towerGames),
    rollRounds: asMap(raw.rollRounds),
  };
}

export async function loadV1Store(storePath: string): Promise<V1Store> {
  const bytes = await readFile(storePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(parsed)) {
    throw new Error("store.json root must be an object");
  }
  return storeFromObject(parsed, sha256);
}

export const OMITTED_CACHE_KEYS = [
  "webSessions",
  "kickOAuthStates",
  "kickWebhookEvents",
  "kickLivestreamState",
  "deviceIndex",
  "ipHashIndex",
  "antiAbuseAudit",
  "pendingBotStarts",
  "botLaunchStarts",
  "events",
  "coinTransactions",
  "txIndexByUser",
  "kickByTelegram",
  "kickFollows",
  "rollMeta",
  "appSettings",
  "broadcasts",
  "referralContests",
  "communityAccessRequests",
  "manualReferralCredits",
] as const;
