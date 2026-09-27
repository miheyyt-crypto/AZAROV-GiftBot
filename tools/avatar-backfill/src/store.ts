import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type FrozenV1Store = {
  sha256: string;
  users: Record<string, Record<string, unknown>>;
  kickAccounts: Record<string, Record<string, unknown>>;
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

export function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function storeFromObject(raw: Record<string, unknown>): FrozenV1Store {
  const encoded = JSON.stringify(raw);
  return {
    sha256: createHash("sha256").update(encoded).digest("hex"),
    users: asMap(raw.users),
    kickAccounts: asMap(raw.kickAccounts),
  };
}

export async function loadFrozenV1Store(storePath: string): Promise<FrozenV1Store> {
  const buf = await readFile(storePath);
  const parsed: unknown = JSON.parse(buf.toString("utf8"));
  if (!isRecord(parsed)) {
    throw new Error("store.json root must be an object");
  }
  const store = storeFromObject(parsed);
  store.sha256 = createHash("sha256").update(buf).digest("hex");
  return store;
}

export function kickUserIdOf(user: Record<string, unknown>): string | undefined {
  return (
    readOptionalString(user.kickUserId) ??
    readOptionalString(user.kick_user_id) ??
    readOptionalString(user.kickId)
  );
}
