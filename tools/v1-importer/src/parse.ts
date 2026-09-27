import { createHash } from "node:crypto";
import type { WalletTransactionType } from "@giftbot/domain";

export const V1_EXPORT_FORMAT = "giftbot-v1-export" as const;

export type ImportMode = "snapshot" | "full_history";

export const LEDGER_TYPES = [
  "deposit",
  "reward",
  "referral_reward",
  "purchase",
  "bet",
  "prize",
  "refund",
  "admin_adjustment",
  "reversal",
] as const satisfies readonly WalletTransactionType[];

export type V1ExportLedgerRow = {
  legacyTxId: string;
  type: WalletTransactionType;
  amountMinor: bigint;
};

export type V1ExportUser = {
  telegramUserId: bigint;
  username?: string;
  firstName?: string;
  lastName?: string;
  locale?: string;
  balanceMinor: bigint;
  legacyId?: string;
  ledger: V1ExportLedgerRow[];
};

export type V1ExportDocument = {
  format: typeof V1_EXPORT_FORMAT;
  version: 1;
  users: V1ExportUser[];
};

export class V1ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "V1ExportError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInteger(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new V1ExportError(`${field} must be an integer`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new V1ExportError(`${field} must be an integer`);
}

function parseOptionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new V1ExportError(`${field} must be a non-empty string when set`);
  }
  return value;
}

function parseLedgerType(value: unknown): WalletTransactionType {
  if (
    typeof value === "string" &&
    (LEDGER_TYPES as readonly string[]).includes(value)
  ) {
    return value as WalletTransactionType;
  }
  throw new V1ExportError(`ledger type is not a V2 wallet type: ${String(value)}`);
}

function parseLedger(value: unknown, telegramUserId: bigint): V1ExportLedgerRow[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new V1ExportError(`users[${telegramUserId}].ledger must be an array`);
  }
  const seen = new Set<string>();
  return value.map((row, index) => {
    if (!isRecord(row)) {
      throw new V1ExportError(`users[${telegramUserId}].ledger[${index}] is invalid`);
    }
    const legacyTxId = parseOptionalString(row.legacy_tx_id, "legacy_tx_id");
    if (!legacyTxId) {
      throw new V1ExportError(`users[${telegramUserId}].ledger[${index}].legacy_tx_id is required`);
    }
    if (seen.has(legacyTxId)) {
      throw new V1ExportError(`duplicate legacy_tx_id ${legacyTxId}`);
    }
    seen.add(legacyTxId);
    return {
      legacyTxId,
      type: parseLedgerType(row.type),
      amountMinor: parseInteger(row.amount_minor, "amount_minor"),
    };
  });
}

function parseUser(value: unknown, index: number): V1ExportUser {
  if (!isRecord(value)) {
    throw new V1ExportError(`users[${index}] must be an object`);
  }
  const telegramUserId = parseInteger(
    value.telegram_user_id,
    `users[${index}].telegram_user_id`,
  );
  if (telegramUserId <= 0n) {
    throw new V1ExportError("telegram_user_id must be positive");
  }
  const balanceMinor = parseInteger(
    value.balance_minor,
    `users[${index}].balance_minor`,
  );
  if (balanceMinor < 0n) {
    throw new V1ExportError(`users[${telegramUserId}].balance_minor must be >= 0`);
  }
  const user: V1ExportUser = {
    telegramUserId,
    balanceMinor,
    ledger: parseLedger(value.ledger, telegramUserId),
  };
  const username = parseOptionalString(value.username, "username");
  const firstName = parseOptionalString(value.first_name, "first_name");
  const lastName = parseOptionalString(value.last_name, "last_name");
  const locale = parseOptionalString(value.locale, "locale");
  const legacyId = parseOptionalString(value.legacy_id, "legacy_id");
  if (username) user.username = username;
  if (firstName) user.firstName = firstName;
  if (lastName) user.lastName = lastName;
  if (locale) user.locale = locale;
  if (legacyId) user.legacyId = legacyId;
  return user;
}

export function parseV1Export(raw: unknown): V1ExportDocument {
  if (!isRecord(raw)) {
    throw new V1ExportError("V1 export must be a JSON object");
  }
  if (raw.store !== undefined || raw.store_json !== undefined) {
    throw new V1ExportError(
      "store.json is not a runtime or import store; produce a giftbot-v1-export mapping",
    );
  }
  if (raw.format !== V1_EXPORT_FORMAT) {
    throw new V1ExportError(
      `unsupported V1 source; expected format ${V1_EXPORT_FORMAT}`,
    );
  }
  if (raw.version !== 1) {
    throw new V1ExportError("unsupported giftbot-v1-export version");
  }
  if (!Array.isArray(raw.users)) {
    throw new V1ExportError("users must be an array");
  }

  const users = raw.users.map((row, index) => parseUser(row, index));
  const seen = new Set<string>();
  for (const user of users) {
    const key = user.telegramUserId.toString();
    if (seen.has(key)) {
      throw new V1ExportError(`duplicate telegram_user_id ${key}`);
    }
    seen.add(key);
  }

  return { format: V1_EXPORT_FORMAT, version: 1, users };
}

export function hashV1Export(doc: V1ExportDocument): string {
  const canonical = JSON.stringify({
    format: doc.format,
    version: doc.version,
    users: doc.users.map((user) => ({
      telegram_user_id: user.telegramUserId.toString(),
      balance_minor: user.balanceMinor.toString(),
      legacy_id: user.legacyId ?? null,
      ledger: user.ledger.map((row) => ({
        legacy_tx_id: row.legacyTxId,
        type: row.type,
        amount_minor: row.amountMinor.toString(),
      })),
    })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function parseImportMode(value: string | undefined): ImportMode {
  if (value === undefined || value === "snapshot") {
    return "snapshot";
  }
  if (value === "full_history") {
    return "full_history";
  }
  throw new V1ExportError("mode must be snapshot or full_history");
}
